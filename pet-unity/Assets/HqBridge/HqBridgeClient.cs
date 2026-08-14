using System;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace HqBridge
{
    /// <summary>
    /// Electron 主进程 ↔ Unity 桌宠的 WebSocket 客户端。
    /// 协议见 docs/0.4.0-mate-parity/集成架构.md；一行一条 JSON。
    /// 网络线程只负责收字节，收齐的行放队列，统一在主线程 Update 里派发，避免线程越界。
    /// </summary>
    public class HqBridgeClient : MonoBehaviour
    {
        public static HqBridgeClient Instance { get; private set; }

        public bool Connected { get; private set; }

        public event Action<JObject> OnConfig;
        public event Action<string> OnAction;
        public event Action<JObject> OnChat;
        public event Action<JObject> OnState;
        public event Action OnDisconnected;

        private Uri _url;
        private ClientWebSocket _ws;
        private CancellationTokenSource _cts;
        private readonly ConcurrentQueue<string> _inbox = new ConcurrentQueue<string>();
        private readonly StringBuilder _recv = new StringBuilder();
        private readonly byte[] _readBuf = new byte[8192];
        private float _lastPing;
        private float _lastPong = -1f;

        public void Init(Uri url)
        {
            _url = url;
        }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private void Start()
        {
            _ = ConnectLoopAsync();
        }

        private void Update()
        {
            while (_inbox.TryDequeue(out var line))
            {
                Dispatch(line);
            }

            if (Connected && Time.realtimeSinceStartup - _lastPing > 5f)
            {
                _lastPing = Time.realtimeSinceStartup;
                _ = SendRawAsync("{\"type\":\"ping\",\"payload\":{}}");
                // 15 秒内没收到 pong 判定为链路死亡，触发重连。
                if (_lastPong >= 0f && Time.realtimeSinceStartup - _lastPong > 15f)
                {
                    Debug.LogWarning("[HqBridge] 心跳超时，断开重连");
                    Disconnect();
                }
            }
        }

        private void OnDestroy()
        {
            Disconnect();
            if (Instance == this) Instance = null;
        }

        private async Task ConnectLoopAsync()
        {
            while (enabled)
            {
                try
                {
                    _cts = new CancellationTokenSource();
                    _ws = new ClientWebSocket();
                    await _ws.ConnectAsync(_url, _cts.Token);
                    Connected = true;
                    _lastPong = Time.realtimeSinceStartup;
                    SendEvent("ready", new JObject());
                    await ReceiveLoopAsync(_cts.Token);
                }
                catch (Exception e) when (!(e is OperationCanceledException))
                {
                    if (Connected) OnDisconnected?.Invoke();
                    Connected = false;
                    Debug.LogWarning($"[HqBridge] 连接失败，2 秒后重试: {e.Message}");
                }
                finally
                {
                    Connected = false;
                }

                await Task.Delay(2000);
            }
        }

        private async Task ReceiveLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested && _ws != null && _ws.State == WebSocketState.Open)
            {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(_readBuf), token);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    break;
                }
                var chunk = Encoding.UTF8.GetString(_readBuf, 0, result.Count);
                _recv.Append(chunk);
                DrainLines();
            }
        }

        private void DrainLines()
        {
            var text = _recv.ToString();
            var idx = text.IndexOf('\n');
            while (idx >= 0)
            {
                var line = text.Substring(0, idx).TrimEnd('\r').Trim();
                if (line.Length > 0) _inbox.Enqueue(line);
                text = text.Substring(idx + 1);
                idx = text.IndexOf('\n');
            }
            _recv.Clear();
            _recv.Append(text);
        }

        private void Dispatch(string line)
        {
            try
            {
                var msg = JObject.Parse(line);
                var type = (string)msg["type"];
                switch (type)
                {
                    case "config":
                        OnConfig?.Invoke((JObject)msg["payload"]);
                        break;
                    case "action":
                        OnAction?.Invoke((string)((JObject)msg["payload"])["action"]);
                        break;
                    case "chat":
                        OnChat?.Invoke((JObject)msg["payload"]);
                        break;
                    case "state":
                        OnState?.Invoke((JObject)msg["payload"]);
                        break;
                    case "pong":
                        _lastPong = Time.realtimeSinceStartup;
                        break;
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[HqBridge] 消息解析失败: {e.Message}\n{line}");
            }
        }

        public void SendEvent(string evt, JObject payload)
        {
            _ = SendRawAsync(JsonConvert.SerializeObject(new
            {
                type = "event",
                payload = JObject.FromObject(new { @event = evt, payload = payload ?? new JObject() })
            }));
        }

        public void SendChatInput(string text)
        {
            _ = SendRawAsync(JsonConvert.SerializeObject(new
            {
                type = "chat-input",
                payload = new { text }
            }));
        }

        private async Task SendRawAsync(string line)
        {
            if (_ws == null || _ws.State != WebSocketState.Open) return;
            try
            {
                var bytes = Encoding.UTF8.GetBytes(line + "\n");
                await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts?.Token ?? CancellationToken.None);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[HqBridge] 发送失败: {e.Message}");
            }
        }

        public void Disconnect()
        {
            try
            {
                _cts?.Cancel();
                _ws?.Abort();
            }
            catch
            {
                // 忽略关闭阶段的竞态异常
            }
            finally
            {
                _ws?.Dispose();
                _ws = null;
                _cts?.Dispose();
                _cts = null;
                Connected = false;
            }
        }
    }
}
