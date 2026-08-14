using HqPet;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace HqBridge
{
    /// <summary>
    /// Electron 下发的配置 → 黄泉桌宠(HqPetLoader/HqPetWindow)。
    /// 场景无关: 轮询等待 HqPetLoader 就绪, 场景改名也不受影响。
    /// </summary>
    public class HqPetController : MonoBehaviour
    {
        private string _form = "normal";

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

        private void ApplyConfig(JObject cfg)
        {
            var form = (string)cfg["form"];
            if (!string.IsNullOrEmpty(form) && form != _form)
            {
                _form = form;
                var loader = HqPetLoader.Instance;
                if (loader != null) loader.LoadForm(form);
            }

            var loader2 = HqPetLoader.Instance;
            if (loader2 != null)
            {
                var scale = Num(cfg["scale"]);
                if (scale.HasValue)
                    loader2.transform.localScale = Vector3.one * Mathf.Clamp(scale.Value, 0.3f, 2.5f);
            }

            var win = HqPetWindow.Instance;
            if (win != null)
            {
                if (cfg["topmost"] != null) win.SetTopmost((bool)cfg["topmost"]);
                if (cfg["clickThrough"] != null) win.SetClickThrough((bool)cfg["clickThrough"]);
            }
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

    }
}
