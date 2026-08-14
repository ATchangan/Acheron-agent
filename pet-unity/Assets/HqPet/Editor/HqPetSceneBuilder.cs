using System.IO;
using HqPet;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace HqPet.EditorTools
{
    /// <summary>
    /// 生成黄泉专属场景 HqPet.unity: 干净相机 + 灯光 + 模型宿主。
    /// 用法: Unity.exe -batchmode -projectPath <proj> -executeMethod HqPet.EditorTools.HqPetSceneBuilder.Build -quit
    /// </summary>
    public static class HqPetSceneBuilder
    {
        public static void Build()
        {
            const string dir = "Assets/HqPet";
            const string scenePath = dir + "/HqPet.unity";

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            Directory.CreateDirectory(Path.GetFullPath(dir));

            // 相机
            var camGo = new GameObject("Main Camera");
            var cam = camGo.AddComponent<Camera>();
            cam.tag = "MainCamera";
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.13f, 0.14f, 0.17f, 1f);
            cam.fieldOfView = 30f;
            cam.nearClipPlane = 0.01f;
            cam.farClipPlane = 100f;
            camGo.transform.position = new Vector3(0f, 1.05f, -4.3f);
            camGo.transform.LookAt(new Vector3(0f, 0.95f, 0f));

            // 主光 + 补光
            var keyGo = new GameObject("Key Light");
            var key = keyGo.AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 1.15f;
            keyGo.transform.rotation = Quaternion.Euler(45f, -30f, 0f);

            var fillGo = new GameObject("Fill Light");
            var fill = fillGo.AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 0.32f;
            fillGo.transform.rotation = Quaternion.Euler(-18f, 120f, 0f);

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.34f, 0.35f, 0.40f, 1f);

            // 模型宿主
            var host = new GameObject("HqPetHost");
            host.AddComponent<HqPetLoader>();

            EditorSceneManager.SaveScene(scene, scenePath);

            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(scenePath, true) };
            Debug.Log("[HqPetScene] 已生成 " + scenePath);
        }
    }
}
