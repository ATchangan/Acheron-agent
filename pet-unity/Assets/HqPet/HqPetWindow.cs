using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace HqPet
{
    /// <summary>
    /// Windows 透明桌宠窗口控制(参考 Mate-Engine 的 DWM/WinApi 方案):
    /// 全窗玻璃合成 + 无边框 Popup + 置顶 + 可选点击穿透 + 拖动。
    /// </summary>
    public class HqPetWindow : MonoBehaviour
    {
        public static HqPetWindow Instance { get; private set; }

        public bool clickThrough = false;

        private IntPtr _hwnd = IntPtr.Zero;
        private long _baseStyle;
        private long _baseExStyle;
        private bool _applied;

        private const int GWL_STYLE = -16;
        private const int GWL_EXSTYLE = -20;
        private const int GWLP_WNDPROC = -4;
        private const uint WM_NCHITTEST = 0x0084;
        private static readonly IntPtr HTCAPTION = new IntPtr(2);
        private const long WS_POPUP = 0x80000000L;
        private const long WS_CAPTION = 0x00C00000L;
        private const long WS_THICKFRAME = 0x00040000L;
        private const long WS_EX_LAYERED = 0x00080000L;
        private const long WS_EX_TRANSPARENT = 0x00000020L;
        private const long WS_EX_TOPMOST = 0x00000008L;

        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_FRAMECHANGED = 0x0020;
        private const uint SWP_SHOWWINDOW = 0x0040;

        // 颜色键: 与场景相机背景一致的纯品红
        private const uint COLOR_KEY = 0x00FF00FF;
        private const uint LWA_COLORKEY = 0x00000001;
        private const uint LWA_ALPHA = 0x00000002;

        [DllImport("user32.dll")] private static extern IntPtr GetActiveWindow();
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")] private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")] private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);
        [DllImport("user32.dll")] private static extern bool SetLayeredWindowAttributes(IntPtr hWnd, uint crKey, byte bAlpha, uint dwFlags);
        [DllImport("user32.dll")] private static extern IntPtr CallWindowProc(IntPtr lpPrevWndFunc, IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        private delegate IntPtr WndProcDelegate(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        // 静态引用防止委托被 GC 回收后回调崩溃
        private static WndProcDelegate _wndProcDelegate;
        private IntPtr _originalWndProc = IntPtr.Zero;

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }
            Instance = this;
        }

        private void Start()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            Apply();
#endif
        }

        private void Update()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (_applied && clickThrough)
            {
                var ex = GetWindowLongPtr(_hwnd, GWL_EXSTYLE).ToInt64();
                if ((ex & WS_EX_TRANSPARENT) == 0)
                {
                    SetWindowLongPtr(_hwnd, GWL_EXSTYLE, new IntPtr(ex | WS_EX_TRANSPARENT));
                }
            }
#endif
        }

        public void Apply()
        {
            _hwnd = GetActiveWindow();
            if (_hwnd == IntPtr.Zero) return;

            // 1) 无边框 Popup
            _baseStyle = GetWindowLongPtr(_hwnd, GWL_STYLE).ToInt64();
            var style = _baseStyle & ~(WS_CAPTION | WS_THICKFRAME);
            style |= WS_POPUP;
            SetWindowLongPtr(_hwnd, GWL_STYLE, new IntPtr(style));

            // 2) 置顶 + 分层 + 穿透(可切换)
            _baseExStyle = GetWindowLongPtr(_hwnd, GWL_EXSTYLE).ToInt64();
            var ex = _baseExStyle | WS_EX_LAYERED | WS_EX_TOPMOST;
            if (clickThrough) ex |= WS_EX_TRANSPARENT;
            SetWindowLongPtr(_hwnd, GWL_EXSTYLE, new IntPtr(ex));

            // 3) 颜色键挖空 + 不透明(alpha=255)
            SetLayeredWindowAttributes(_hwnd, COLOR_KEY, 255, LWA_COLORKEY | LWA_ALPHA);

            // 4) 子类化窗口: 整窗视为标题栏, 左键拖动即移动
            _wndProcDelegate = WndProc;
            _originalWndProc = SetWindowLongPtr(_hwnd, GWLP_WNDPROC, Marshal.GetFunctionPointerForDelegate(_wndProcDelegate));

            SetWindowPos(_hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW);
            _applied = true;
            Debug.Log($"[HqPetWindow] 透明窗口已应用 hwnd={_hwnd} style=0x{style:X} ex=0x{ex:X}");
        }

        private IntPtr WndProc(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            // 整个窗口可拖动; 后续做区域命中测试时再按角色轮廓区分 点击/拖动
            if (msg == WM_NCHITTEST) return HTCAPTION;
            return CallWindowProc(_originalWndProc, hWnd, msg, wParam, lParam);
        }

        public void SetClickThrough(bool on)
        {
            clickThrough = on;
            if (!_applied) return;
            var ex = GetWindowLongPtr(_hwnd, GWL_EXSTYLE).ToInt64();
            if (on) ex |= WS_EX_TRANSPARENT;
            else ex &= ~WS_EX_TRANSPARENT;
            SetWindowLongPtr(_hwnd, GWL_EXSTYLE, new IntPtr(ex));
        }

        public void SetTopmost(bool on)
        {
            if (!_applied) return;
            SetWindowPos(_hwnd, on ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        public void SetPosition(int x, int y)
        {
            if (!_applied) return;
            SetWindowPos(_hwnd, HWND_TOPMOST, x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
        }

        public void SetSize(int width, int height)
        {
            if (!_applied) return;
            SetWindowPos(_hwnd, HWND_TOPMOST, 0, 0, width, height, SWP_NOMOVE | SWP_NOACTIVATE);
        }
    }
}
