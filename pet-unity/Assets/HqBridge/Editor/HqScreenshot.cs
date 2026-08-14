using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace HqBridge.EditorTools
{
    /// <summary>
    /// 无头截图验证入口: 打开主场景→进入播放→载入指定 VRM→等待动作稳定→截屏→退出。
    /// 用法:
    ///   Unity.exe -batchmode -projectPath <proj> -executeMethod HqBridge.EditorTools.HqScreenshot.Capture
    ///             -vrm "D:\...\index.vrm" -shot "D:\...\_pet_shots\m1.png" -frames 240 -quit -logFile <log>
    /// 图片随后用本地 vision 命令做视觉回归。
    /// </summary>
    public static class HqScreenshot
    {
        private static int _frame;
        private static float _startTime;
        private static float _shotAt;
        private static bool _loading;
        private static string _diag = "";

        public static void Capture()
        {
            var args = Environment.GetCommandLineArgs();
            var vrm = ReadArg(args, "-vrm");
            var shot = ReadArg(args, "-shot") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "hq_pet_shot.png");
            var wait = ReadIntArg(args, "-wait", 12);
            var keep = HasArg(args, "-keep");

            try
            {
                EditorSceneManager.OpenScene("Assets/MATE ENGINE - Scenes/Mate Engine Main.unity", OpenSceneMode.Single);
            }
            catch (Exception e)
            {
                Debug.LogError($"[HqShot] 打开主场景失败: {e}");
                EditorApplication.Exit(1);
                return;
            }

            // 进 Play Mode 前关闭域重载/场景重载, 否则域重载会销毁我们注册的 update 回调
            EditorSettings.enterPlayModeOptionsEnabled = true;
            EditorSettings.enterPlayModeOptions =
                EnterPlayModeOptions.DisableDomainReload | EnterPlayModeOptions.DisableSceneReload;
            EditorApplication.EnterPlaymode();
            _frame = 0;
            _startTime = Time.realtimeSinceStartup;
            _shotAt = -1f;
            _loading = false;
            EditorApplication.update += OnUpdate;

            void OnUpdate()
            {
                if (!EditorApplication.isPlaying) return;
                _frame++;

                if (!_loading && !string.IsNullOrEmpty(vrm) && Time.realtimeSinceStartup - _startTime > 3f)
                {
                    _loading = true;
                    var loader = UnityEngine.Object.FindFirstObjectByType<VRMLoader>();
                    if (loader != null) loader.LoadVRM(vrm);
                    else Debug.LogWarning("[HqShot] 未找到 VRMLoader, 使用场景默认模型");
                    Debug.Log("[HqShot] 已请求载入 VRM: " + vrm);
                }

                if (_frame % 120 == 0)
                    Debug.Log($"[HqShot] frame={_frame} t={Time.realtimeSinceStartup - _startTime:F1}s");

                if (Time.realtimeSinceStartup - _startTime < wait) return;
                if (_shotAt > 0f) return;
                _shotAt = Time.realtimeSinceStartup;

                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(shot) ?? ".");
                    var ok = DiagCameraShot(shot);
                    Debug.Log($"[HqShot] 诊断截图{(ok ? "成功" : "失败")}: {shot} @ frame={_frame}\n{_diag}");
                }
                catch (Exception e)
                {
                    Debug.LogError($"[HqShot] 截图失败: {e}");
                    EditorApplication.Exit(1);
                    return;
                }

                // 截图写入是延迟一帧的, 再等 3 秒确保落盘后退出; -keep 则留在播放态供人工查看
                if (Time.realtimeSinceStartup - _shotAt > 3f)
                {
                    EditorApplication.update -= OnUpdate;
                    if (!keep) EditorApplication.Exit(0);
                }
            }
        }

        /// <summary>
        /// 用独立相机按模型包围盒取景, 渲染到 RT 后写 PNG。
        /// 绕过 Game 视图/透明窗口, 保证无论场景相机怎么配都能看到模型。
        /// </summary>
        private static bool DiagCameraShot(string path)
        {
            var loaders = UnityEngine.Object.FindObjectsByType<VRMLoader>(FindObjectsSortMode.None);
            var output = loaders.Length > 0 ? loaders[0].customModelOutput : null;
            var roots = output != null
                ? Enumerable.Range(0, output.transform.childCount).Select(i => output.transform.GetChild(i).gameObject)
                : UnityEngine.Object.FindObjectsByType<GameObject>(FindObjectsSortMode.None).Where(g => g.transform.parent == null);

            var renderers = new List<Renderer>();
            foreach (var root in roots)
            {
                renderers.AddRange(root.GetComponentsInChildren<Renderer>(true));
            }
            if (renderers.Count == 0)
            {
                _diag = "没有找到任何 Renderer(自定义模型可能未激活)";
                return false;
            }

            // 验证用途: 无论 Mate-Engine 运行态为何隐藏模型, 诊断相机都强制激活并渲染
            var activeRoots = new List<string>();
            foreach (var root in roots)
            {
                root.SetActive(true);
                activeRoots.Add(root.name + ":" + root.activeSelf);
            }
            foreach (var r in renderers) r.enabled = true;

            var matInfo = new List<string>();
            foreach (var r in renderers)
            {
                foreach (var m in r.sharedMaterials)
                {
                    if (m != null) matInfo.Add(m.name + "@" + m.shader.name);
                }
            }
            _diag += "\nshaders: " + string.Join("; ", matInfo.Distinct().Take(12));

            var bounds = renderers[0].bounds;
            var validBounds = false;
            foreach (var r in renderers)
            {
                if (r.bounds.size.sqrMagnitude > 0.0001f)
                {
                    if (!validBounds) { bounds = r.bounds; validBounds = true; }
                    else bounds.Encapsulate(r.bounds);
                }
            }
            _diag = string.Format(
                "renderers={0} roots=[{4}] center={2} size={3}",
                renderers.Count,
                renderers.Count(r => r.enabled && r.gameObject.activeInHierarchy),
                bounds.center,
                bounds.size,
                string.Join(",", activeRoots));

            // 几何体自检: 临时换纯色 Unlit 材质, 若可见说明网格正常、问题在 VRM 材质
            var originalMats = new Dictionary<Renderer, Material[]>();
            var testMat = new Material(Shader.Find("Unlit/Color"));
            testMat.color = new Color(0.85f, 0.85f, 0.9f, 1f);
            foreach (var r in renderers)
            {
                originalMats[r] = r.sharedMaterials;
                var mats = new Material[r.sharedMaterials.Length];
                for (var i = 0; i < mats.Length; i++) mats[i] = testMat;
                r.sharedMaterials = mats;
            }

            var camGo = new GameObject("[HqDiagCamera]");
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.13f, 0.14f, 0.17f, 1f);
            cam.fieldOfView = 28f;
            cam.nearClipPlane = 0.01f;
            cam.farClipPlane = 50f;
            var maxDim = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z, 0.5f);
            var distance = maxDim * 2.1f;
            camGo.transform.position = bounds.center + new Vector3(0f, maxDim * 0.15f, -distance);
            camGo.transform.LookAt(bounds.center);
            cam.cullingMask = -1;

            const int size = 1024;
            var rt = RenderTexture.GetTemporary(size, size, 24, RenderTextureFormat.ARGB32);
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            var tex = new Texture2D(size, size, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, size, size), 0, 0);
            tex.Apply();
            File.WriteAllBytes(path, tex.EncodeToPNG());
            RenderTexture.active = null;
            RenderTexture.ReleaseTemporary(rt);
            UnityEngine.Object.DestroyImmediate(tex);
            UnityEngine.Object.DestroyImmediate(camGo);
            return true;
        }

        private static string ReadArg(string[] args, string name)
        {
            for (var i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                    return args[i + 1];
            }
            return null;
        }

        private static int ReadIntArg(string[] args, string name, int fallback)
        {
            var raw = ReadArg(args, name);
            return int.TryParse(raw, out var value) ? value : fallback;
        }

        private static bool HasArg(string[] args, string name)
        {
            foreach (var arg in args)
            {
                if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
    }
}
