using System;
using System.IO;
using HqPet;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace HqPet.EditorTools
{
    /// <summary>
    /// 打开 HqPet.unity → 同步载入指定 VRM → 离屏渲染 → 写 PNG。
    /// 用法: Unity.exe -batchmode -projectPath <proj> -executeMethod HqPet.EditorTools.HqPetCapture.Capture
    ///        -vrm <file> -shot <png> -logFile <log> -quit
    /// </summary>
    public static class HqPetCapture
    {
        public static void Capture()
        {
            var args = Environment.GetCommandLineArgs();
            var vrm = ReadArg(args, "-vrm");
            var shot = ReadArg(args, "-shot") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "hqpet.png");

            EditorSceneManager.OpenScene("Assets/HqPet/HqPet.unity", OpenSceneMode.Single);

            var loader = UnityEngine.Object.FindFirstObjectByType<HqPetLoader>();
            if (loader == null)
            {
                var go = new GameObject("HqPetHost");
                loader = go.AddComponent<HqPetLoader>();
            }

            var model = loader.LoadModelSync(vrm);
            if (model == null)
            {
                Debug.LogError("[HqPetCapture] 模型加载失败");
                EditorApplication.Exit(1);
                return;
            }

            Directory.CreateDirectory(Path.GetDirectoryName(shot) ?? ".");
            RenderToFile(shot);
            EditorApplication.Exit(0);
        }

        private static void RenderToFile(string path)
        {
            var cam = Camera.main;
            if (cam == null)
            {
                var go = new GameObject("Capture Cam");
                cam = go.AddComponent<Camera>();
                cam.fieldOfView = 30f;
                cam.transform.position = new Vector3(0f, 1.05f, -4.3f);
                cam.transform.LookAt(new Vector3(0f, 0.95f, 0f));
            }
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.13f, 0.14f, 0.17f, 1f);

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
