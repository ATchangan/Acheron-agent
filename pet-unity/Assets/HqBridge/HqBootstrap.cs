using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using UnityEngine;

namespace HqBridge
{
    /// <summary>
    /// 解析 Electron 传入的命令行参数，创建并初始化桥接组件。
    /// 用法: HuangquanPet.exe -connect "ws://127.0.0.1:9420?token=abc"
    /// </summary>
    public static class HqBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Run()
        {
            var connect = ReadArg("-connect");
            if (string.IsNullOrEmpty(connect))
            {
                // 未带桥接参数时仍允许独立运行（调试模式），不打日志噪音。
                return;
            }

            if (!Uri.TryCreate(connect, UriKind.Absolute, out var uri) ||
                (uri.Scheme != "ws" && uri.Scheme != "wss"))
            {
                Debug.LogError($"[HqBridge] 非法连接地址: {connect}");
                return;
            }

            var go = new GameObject("[HqBridge]");
            UnityEngine.Object.DontDestroyOnLoad(go);
            var client = go.AddComponent<HqBridgeClient>();
            go.AddComponent<HqPetController>();
            client.Init(uri);
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
