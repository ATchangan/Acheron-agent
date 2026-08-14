using UnityEngine;

namespace HqPet
{
    /// <summary>
    /// 2x 超采样抗锯齿: 主相机渲染到 2 倍分辨率 RT,
    /// 再用第二台相机把全屏四边形按“品红感知”降采样回窗口。
    /// 颜色键透明方案下也能获得平滑无锯齿的轮廓与描边。
    /// </summary>
    public class HqSsa : MonoBehaviour
    {
        [SerializeField] private int supersample = 2;
        private const int BlitLayer = 2; // Ignore Raycast 内置层, 避免主相机重复渲染

        private Camera _main;
        private Camera _blit;
        private RenderTexture _rt;
        private GameObject _blitGo;

        private void OnEnable()
        {
            Setup();
        }

        private void OnDisable()
        {
            Teardown();
        }

        private void Setup()
        {
            _main = GetComponent<Camera>();
            if (_main == null) return;

            var w = Mathf.Max(4, _main.pixelWidth * supersample);
            var h = Mathf.Max(4, _main.pixelHeight * supersample);
            _rt = new RenderTexture(w, h, 24, RenderTextureFormat.ARGB32)
            {
                name = "HqSsaRT",
                filterMode = FilterMode.Bilinear,
            };
            _rt.Create();
            _main.targetTexture = _rt;
            _main.cullingMask &= ~(1 << BlitLayer);

            var shader = Shader.Find("HqPet/HqSsaBlit");
            if (shader == null)
            {
                Debug.LogError("[HqSsa] 找不到 HqPet/HqSsaBlit");
                return;
            }

            _blitGo = new GameObject("HqSsaBlit");
            _blitGo.layer = BlitLayer;
            _blitGo.transform.SetParent(_main.transform, false);

            var mf = _blitGo.AddComponent<MeshFilter>();
            mf.sharedMesh = BuildFullscreenQuad();
            var mr = _blitGo.AddComponent<MeshRenderer>();
            mr.sharedMaterial = new Material(shader) { name = "HqSsaBlitMat" };
            mr.sharedMaterial.SetTexture("_MainTex", _rt);
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;

            _blit = _blitGo.AddComponent<Camera>();
            _blit.clearFlags = CameraClearFlags.Nothing;
            _blit.orthographic = true;
            _blit.orthographicSize = 1f;
            _blit.cullingMask = 1 << BlitLayer;
            _blit.depth = _main.depth + 1f;
            _blit.allowHDR = false;
            _blit.allowMSAA = false;

            Debug.Log($"[HqSsa] 超采样已启用 {w}x{h} -> {_main.pixelWidth}x{_main.pixelHeight}");
        }

        private void Teardown()
        {
            if (_main != null) _main.targetTexture = null;
            if (_blitGo != null) Destroy(_blitGo);
            if (_rt != null)
            {
                _rt.Release();
                Destroy(_rt);
            }
            _main = null;
            _blit = null;
            _rt = null;
            _blitGo = null;
        }

        private static Mesh BuildFullscreenQuad()
        {
            var mesh = new Mesh
            {
                name = "HqSsaQuad",
                vertices = new[]
                {
                    new Vector3(-1f, -1f, 0f),
                    new Vector3(1f, -1f, 0f),
                    new Vector3(-1f, 1f, 0f),
                    new Vector3(1f, 1f, 0f),
                },
                uv = new[]
                {
                    new Vector2(0f, 0f),
                    new Vector2(1f, 0f),
                    new Vector2(0f, 1f),
                    new Vector2(1f, 1f),
                },
                triangles = new[] { 0, 1, 2, 2, 1, 3 },
                bounds = new Bounds(Vector3.zero, Vector3.one * 1e6f),
            };
            return mesh;
        }
    }
}
