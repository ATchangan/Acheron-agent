using System;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace HqBridge
{
    /// <summary>
    /// M1 底座: 启动即载入黄泉 VRM, 并把 Electron 下发的配置映射到 Mate-Engine 设置。
    /// 独立于场景内容, 用轮询等待 SaveLoadHandler/VRMLoader 就绪, 场景改名也不受影响。
    /// </summary>
    public class HqPetController : MonoBehaviour
    {
        private string _vrmNormal;
        private string _vrmUltimate;
        private string _form = "normal";
        private bool _initialized;

        public static HqPetController Instance { get; private set; }

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
            DontDestroyOnLoad(gameObject);

            _vrmNormal = ReadArg("-vrm");
            _vrmUltimate = ReadArg("-vrm-ultimate");
            if (string.IsNullOrEmpty(_vrmNormal)) _vrmNormal = _vrmUltimate;
            if (string.IsNullOrEmpty(_vrmUltimate)) _vrmUltimate = _vrmNormal;
        }

        private void OnEnable()
        {
            if (HqBridgeClient.Instance != null)
            {
                HqBridgeClient.Instance.OnConfig += ApplyConfig;
                HqBridgeClient.Instance.OnAction += ApplyAction;
            }
        }

        private void OnDisable()
        {
            if (HqBridgeClient.Instance != null)
            {
                HqBridgeClient.Instance.OnConfig -= ApplyConfig;
                HqBridgeClient.Instance.OnAction -= ApplyAction;
            }
        }

        private void Update()
        {
            if (_initialized) return;
            var save = SaveLoadHandler.Instance;
            var loader = FindFirstObjectByType<VRMLoader>();
            if (save == null || loader == null) return;

            _initialized = true;
            LoadForm(_form);
        }

        private void LoadForm(string form)
        {
            var loader = FindFirstObjectByType<VRMLoader>();
            if (loader == null) return;
            var path = form == "ultimate" ? _vrmUltimate : _vrmNormal;
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
            {
                Debug.LogWarning($"[HqPet] VRM 不存在, 保持默认模型: {path}");
                return;
            }
            var save = SaveLoadHandler.Instance;
            if (save != null)
            {
                save.data.selectedModelPath = path;
                save.SaveToDisk();
            }
            loader.LoadVRM(path);
        }

        private void ApplyConfig(JObject cfg)
        {
            var form = (string)cfg["form"];
            if (!string.IsNullOrEmpty(form) && form != _form)
            {
                _form = form;
                LoadForm(form);
            }

            var save = SaveLoadHandler.Instance;
            if (save == null) return;
            var data = save.data;

            var scale = Num(cfg["scale"]);
            if (scale.HasValue) data.avatarSize = Mathf.Clamp(scale.Value, 0.3f, 2.5f);

            var fps = Num(cfg["fps"]);
            if (fps.HasValue) data.fpsLimit = (int)Mathf.Clamp(fps.Value, 10, 240);

            if (cfg["topmost"] != null) data.isTopmost = (bool)cfg["topmost"];

            save.SaveToDisk();
            SaveLoadHandler.ApplyAllSettingsToAllAvatars();
        }

        private void ApplyAction(string action)
        {
            // 舞蹈/喂食/戳头等动作由 Animator 层接管, M4 起逐步映射
            HqBridgeClient.Instance?.SendEvent("action-ack", JObject.FromObject(new { action }));
        }

        private static float? Num(JToken token)
        {
            if (token == null || token.Type == JTokenType.Null) return null;
            try { return (float)token; }
            catch { return null; }
        }

        private static string ReadArg(string name)
        {
            var args = Environment.GetCommandLineArgs();
            for (var i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                    return args[i + 1];
            }
            return null;
        }
    }
}
