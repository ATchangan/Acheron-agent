using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UniGLTF;
using UniVRM10;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace HqBridge.EditorTools
{
    /// <summary>
    /// 隔离诊断: 不依赖 Mate-Engine 主场景, 在空场景直接加载黄泉 VRM 并离屏渲染。
    /// 输出: <out>/vrm_original.png(原始材质)、vrm_unlit.png(强制Unlit)、diag.txt(逐网格信息)。
    /// 用法: Unity.exe -batchmode -projectPath <proj> -executeMethod HqBridge.EditorTools.HqDiagVrm.Capture
    ///        -vrm <file> -out <dir> -logFile <log> -quit
    /// </summary>
    public static class HqDiagVrm
    {
        public static void Capture()
        {
            var args = Environment.GetCommandLineArgs();
            var vrmPath = ReadArg(args, "-vrm");
            var outDir = ReadArg(args, "-out") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "hqdiag");
            Directory.CreateDirectory(outDir);
            var sb = new System.Text.StringBuilder();

            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            GameObject model = null;
            try
            {
                var data = new GlbFileParser(vrmPath).Parse();
                var vrm10 = Vrm10Data.Parse(data);
                if (vrm10 != null)
                {
                    using var importer = new Vrm10Importer(vrm10);
                    var inst = importer.LoadAsync(new ImmediateCaller()).GetAwaiter().GetResult();
                    model = inst.Root;
                    model.AddComponent<GltfInstanceDisposer>().Bind(inst);
                }
            }
            catch (Exception e)
            {
                sb.AppendLine("LOAD-ERROR: " + e);
            }

            if (model == null)
            {
                File.WriteAllText(Path.Combine(outDir, "diag.txt"), sb.ToString());
                EditorApplication.Exit(1);
                return;
            }

            model.transform.position = Vector3.zero;
            model.SetActive(true);

            var lightGo = new GameObject("[DiagLight]");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.1f;
            lightGo.transform.rotation = Quaternion.Euler(45f, -30f, 0f);

            var renderers = model.GetComponentsInChildren<Renderer>(true).ToList();
            foreach (var r in renderers) r.enabled = true;

            sb.AppendLine($"renderers={renderers.Count}");
            foreach (var r in renderers)
            {
                var mats = r.sharedMaterials;
                var shaders = mats.Where(m => m != null).Select(m => m.shader == null ? "<null shader>" : m.shader.name).Distinct();
                sb.AppendLine($"{r.name} | {r.GetType().Name} | mats={mats.Length} | enabled={r.enabled} | layer={r.gameObject.layer} | shaders=[{string.Join(",", shaders)}]");
            }
            sb.AppendLine("Unlit/Color = " + (Shader.Find("Unlit/Color") != null));
            sb.AppendLine("VRM10/MToon10 = " + (Shader.Find("VRM10/MToon10") != null));
            sb.AppendLine("Standard = " + (Shader.Find("Standard") != null));

            var bounds = renderers[0].bounds;
            foreach (var r in renderers.Skip(1)) bounds.Encapsulate(r.bounds);
            sb.AppendLine($"bounds center={bounds.center} size={bounds.size}");

            RenderToFile(outDir, "vrm_original.png", bounds, null);

            var unlit = Shader.Find("Unlit/Color") ?? Shader.Find("Sprites/Default");
            if (unlit != null)
            {
                var tm = new Material(unlit) { color = new Color(0.85f, 0.85f, 0.92f, 1f) };
                var saved = renderers.ToDictionary(r => r, r => r.sharedMaterials);
                foreach (var r in renderers)
                {
                    var arr = new Material[r.sharedMaterials.Length];
                    for (var i = 0; i < arr.Length; i++) arr[i] = tm;
                    r.sharedMaterials = arr;
                }
                RenderToFile(outDir, "vrm_unlit.png", bounds, null);
                foreach (var r in renderers) r.sharedMaterials = saved[r];
            }
            else
            {
                sb.AppendLine("Unlit fallback NOT FOUND");
            }

            // 对照物: 确认离屏相机管线本身可用
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.transform.position = bounds.center;
            cube.transform.localScale = Vector3.one * 0.5f;
            model.SetActive(false);
            RenderToFile(outDir, "control_cube.png", bounds, null);

            File.WriteAllText(Path.Combine(outDir, "diag.txt"), sb.ToString());
            EditorApplication.Exit(0);
        }

        private static void RenderToFile(string outDir, string fileName, Bounds bounds, Transform cameraTransform)
        {
            var camGo = new GameObject("[DiagCam]");
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.13f, 0.14f, 0.17f, 1f);
            cam.fieldOfView = 30f;
            cam.nearClipPlane = 0.01f;
            cam.farClipPlane = 100f;
            cam.cullingMask = -1;
            var maxDim = Mathf.Max(bounds.size.x, bounds.size.y, bounds.size.z, 0.5f);
            camGo.transform.position = bounds.center + new Vector3(0f, maxDim * 0.2f, -maxDim * 2.1f);
            camGo.transform.LookAt(bounds.center);
            cam.allowHDR = false;

            const int size = 1024;
            var rt = RenderTexture.GetTemporary(size, size, 24, RenderTextureFormat.ARGB32);
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            var tex = new Texture2D(size, size, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, size, size), 0, 0);
            tex.Apply();
            File.WriteAllBytes(Path.Combine(outDir, fileName), tex.EncodeToPNG());
            RenderTexture.active = null;
            RenderTexture.ReleaseTemporary(rt);
            UnityEngine.Object.DestroyImmediate(tex);
            UnityEngine.Object.DestroyImmediate(camGo);
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
    }
}
