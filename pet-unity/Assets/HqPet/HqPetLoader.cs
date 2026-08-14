using System;
using System.IO;
using UniGLTF;
using UniVRM10;
using UnityEngine;

namespace HqPet
{
    /// <summary>
    /// 黄泉桌宠模型宿主: 加载 normal/ultimate 两套 VRM, 双脚落地面零位, 支持形态切换。
    /// 运行期由 Electron 传入 -vrm / -vrm-ultimate 路径; 编辑器诊断脚本可直接调用 LoadModelSync。
    /// </summary>
    public class HqPetLoader : MonoBehaviour
    {
        public static HqPetLoader Instance { get; private set; }

        public GameObject CurrentModel { get; private set; }
        public string CurrentForm { get; private set; } = "normal";

        [SerializeField] private string vrmNormalPath;
        [SerializeField] private string vrmUltimatePath;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;

            vrmNormalPath = ReadArg("-vrm") ?? vrmNormalPath;
            vrmUltimatePath = ReadArg("-vrm-ultimate") ?? vrmUltimatePath;
            var form = ReadArg("-form");
            if (form == "ultimate") CurrentForm = "ultimate";
        }

        private void Start()
        {
            LoadForm(CurrentForm);
        }

        public void LoadForm(string form)
        {
            CurrentForm = form == "ultimate" ? "ultimate" : "normal";
            var path = CurrentForm == "ultimate" ? vrmUltimatePath : vrmNormalPath;
            if (string.IsNullOrEmpty(path) || !File.Exists(path))
            {
                Debug.LogWarning($"[HqPet] VRM 路径无效, 跳过加载: {path}");
                return;
            }
            LoadModelSync(path);
        }

        public void ToggleForm()
        {
            LoadForm(CurrentForm == "ultimate" ? "normal" : "ultimate");
        }

        /// <summary>
        /// 同步加载 VRM(编辑器诊断用; 运行期同样可用, 文件较小时阻塞可接受)。
        /// </summary>
        public GameObject LoadModelSync(string path)
        {
            if (!File.Exists(path))
            {
                Debug.LogError($"[HqPet] 找不到 VRM: {path}");
                return null;
            }

            ClearCurrent();
            try
            {
                var data = new GlbFileParser(path).Parse();
                var vrm10 = Vrm10Data.Parse(data);
                if (vrm10 == null)
                {
                    Debug.LogError($"[HqPet] VRM10 解析失败: {path}");
                    return null;
                }

                using var importer = new Vrm10Importer(vrm10);
                var instance = importer.LoadAsync(new ImmediateCaller()).GetAwaiter().GetResult();
                if (instance == null || instance.Root == null)
                {
                    Debug.LogError("[HqPet] VRM 实例化失败");
                    return null;
                }

                var root = instance.Root;
                root.AddComponent<GltfInstanceDisposer>().Bind(instance);
                root.transform.SetParent(transform, false);
                root.transform.localPosition = Vector3.zero;
                root.transform.localRotation = Quaternion.identity;
                root.transform.localScale = Vector3.one;
                root.SetActive(true);

                foreach (var r in root.GetComponentsInChildren<Renderer>(true)) r.enabled = true;

                HqToonStyler.Apply(root);
                NormalizeFeet(root);
                CurrentModel = root;
                Debug.Log($"[HqPet] 已载入 {CurrentForm}: {path}");
                return root;
            }
            catch (Exception e)
            {
                Debug.LogError("[HqPet] 加载异常: " + e);
                return null;
            }
        }

        /// <summary>把包围盒底边对齐到 y=0, 保证坐窗/坐地时脚贴合参考平面。</summary>
        public void NormalizeFeet(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<Renderer>(true);
            var hasBounds = false;
            var bounds = new Bounds();
            foreach (var r in renderers)
            {
                if (!(r.bounds.size.sqrMagnitude > 0.0001f)) continue;
                if (!hasBounds) { bounds = r.bounds; hasBounds = true; }
                else bounds.Encapsulate(r.bounds);
            }
            if (hasBounds)
            {
                root.transform.localPosition = new Vector3(0f, -bounds.min.y, 0f);
                Debug.Log($"[HqPet] 脚部归零 offset={(-bounds.min.y):F3}, bounds={bounds.center} size={bounds.size}");
            }
        }

        private void ClearCurrent()
        {
            if (CurrentModel != null)
            {
                Destroy(CurrentModel);
                CurrentModel = null;
            }
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
