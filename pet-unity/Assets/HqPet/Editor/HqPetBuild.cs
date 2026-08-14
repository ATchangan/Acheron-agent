using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace HqPet.EditorTools
{
    /// <summary>
    /// 构建黄泉桌宠 exe。
    /// 用法: Unity.exe -batchmode -projectPath <proj> -executeMethod HqPet.EditorTools.HqPetBuild.Build
    ///        -out <dir> -logFile <log> -quit
    /// </summary>
    public static class HqPetBuild
    {
        public static void Build()
        {
            var args = System.Environment.GetCommandLineArgs();
            var outDir = ReadArg(args, "-out") ?? "Builds/HuangquanPet";
            var development = HasArg(args, "-dev");
            Directory.CreateDirectory(outDir);

            var options = new BuildPlayerOptions
            {
                scenes = new[] { "Assets/HqPet/HqPet.unity" },
                locationPathName = Path.Combine(outDir, "HuangquanPet.exe"),
                target = BuildTarget.StandaloneWindows64,
                options = development ? BuildOptions.Development : BuildOptions.None,
            };

            var report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result == BuildResult.Succeeded)
            {
                Debug.Log("[HqPetBuild] 构建成功: " + options.locationPathName);
                EditorApplication.Exit(0);
            }
            else
            {
                Debug.LogError("[HqPetBuild] 构建失败: " + report.summary.result + " / " + report.summary.totalErrors + " errors");
                EditorApplication.Exit(1);
            }
        }

        private static string ReadArg(string[] args, string name)
        {
            for (var i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], name, System.StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                    return args[i + 1];
            }
            return null;
        }

        private static bool HasArg(string[] args, string name)
        {
            foreach (var a in args)
            {
                if (string.Equals(a, name, System.StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }
    }
}
