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
            // 颜色键透明: 纯品红由 SetLayeredWindowAttributes 挖空(alpha 通道不可靠)
            cam.backgroundColor = new Color(1f, 0f, 1f, 1f);
            cam.fieldOfView = 26f;
            cam.nearClipPlane = 0.01f;
            cam.farClipPlane = 100f;
            cam.allowHDR = false;
            camGo.transform.position = new Vector3(0f, 1.05f, -4.3f);
            camGo.transform.LookAt(new Vector3(0f, 0.95f, 0f));
            camGo.AddComponent<HqSsa>();

            // 主光 + 补光
            var keyGo = new GameObject("Key Light");
            var key = keyGo.AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 1.15f;
            keyGo.transform.rotation = Quaternion.Euler(45f, -30f, 0f);

            var fillGo = new GameObject("Fill Light");
            var fill = fillGo.AddComponent<Light>();
            fill.type = LightType.Directional;
            fill.intensity = 0.42f;
            fill.color = new Color(0.92f, 0.95f, 1.05f, 1f);
            fillGo.transform.rotation = Quaternion.Euler(-18f, 120f, 0f);

            // 背后偏冷的轮廓光, 帮助发丝/衣摆从品红背景里分离
            var rimGo = new GameObject("Rim Light");
            var rim = rimGo.AddComponent<Light>();
            rim.type = LightType.Directional;
            rim.intensity = 0.55f;
            rim.color = new Color(0.62f, 0.68f, 0.90f, 1f);
            rimGo.transform.rotation = Quaternion.Euler(18f, 160f, 0f);

            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.46f, 0.48f, 0.56f, 1f);

            // 模型宿主
            var host = new GameObject("HqPetHost");
            host.AddComponent<HqPetLoader>();
            host.AddComponent<HqPetWindow>();
            host.AddComponent<HqIdleMotion>();
            host.AddComponent<HqPetPoke>();
            var shaderRef = host.AddComponent<HqToonShaderRef>();
            shaderRef.shader = Shader.Find(HqToonStyler.ShaderName);

            EditorSceneManager.SaveScene(scene, scenePath);

            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(scenePath, true) };
            ConfigurePlayerSettings();
            EnsureShaderAlwaysIncluded(HqToonStyler.ShaderName);
            EnsureShaderAlwaysIncluded("UniGLTF/UniUnlit");
            EnsureShaderAlwaysIncluded("HqPet/HqSsaBlit");
            Debug.Log("[HqPetScene] 已生成 " + scenePath);
        }

        private static void ConfigurePlayerSettings()
        {
            PlayerSettings.companyName = "ATchangan";
            PlayerSettings.productName = "HuangquanPet";
            PlayerSettings.defaultScreenWidth = 300;
            PlayerSettings.defaultScreenHeight = 450;
            PlayerSettings.resizableWindow = false;
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.runInBackground = true;
            PlayerSettings.visibleInBackground = true;
            PlayerSettings.allowFullscreenSwitch = false;
            // 关键: flip model 交换链不支持 alpha, 透明窗口必须关闭(D3D11 有独立开关)
            PlayerSettings.useFlipModelSwapchain = false;
        }

        /// <summary>
        /// 运行期才 new Material(shader), 场景里没有静态材质引用;
        /// 把 MToon10 加入 Always Included Shaders, 防止 Build 时把 shader/变体裁剪掉。
        /// </summary>
        private static void EnsureShaderAlwaysIncluded(string shaderName)
        {
            var shader = Shader.Find(shaderName);
            if (shader == null)
            {
                Debug.LogError("[HqPetScene] 找不到 shader: " + shaderName);
                return;
            }

            var assets = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset");
            if (assets == null || assets.Length == 0)
            {
                Debug.LogError("[HqPetScene] 无法读取 GraphicsSettings");
                return;
            }

            var so = new SerializedObject(assets[0]);
            var prop = so.FindProperty("m_AlwaysIncludedShaders");
            if (prop == null) return;
            for (var i = 0; i < prop.arraySize; i++)
            {
                if (prop.GetArrayElementAtIndex(i).objectReferenceValue == shader)
                {
                    so.ApplyModifiedPropertiesWithoutUndo();
                    return;
                }
            }
            prop.arraySize++;
            prop.GetArrayElementAtIndex(prop.arraySize - 1).objectReferenceValue = shader;
            so.ApplyModifiedPropertiesWithoutUndo();
            AssetDatabase.SaveAssets();
            Debug.Log("[HqPetScene] 已把 " + shaderName + " 加入 Always Included Shaders");
        }
    }
}
