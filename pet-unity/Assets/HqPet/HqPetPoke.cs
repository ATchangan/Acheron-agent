using UnityEngine;

namespace HqPet
{
    /// <summary>
    /// 戳头反应: 点击落在模型屏幕包围盒内时触发惊跳。
    /// 精确触摸分区(头/脸/身体)后续用 Mate-Engine Touch Regions 方案细化。
    /// </summary>
    public class HqPetPoke : MonoBehaviour
    {
        private HqIdleMotion _idle;
        private Camera _cam;

        private void Start()
        {
            _idle = FindFirstObjectByType<HqIdleMotion>();
            _cam = Camera.main;
        }

        private void Update()
        {
            if (!Input.GetMouseButtonDown(0)) return;
            var loader = HqPetLoader.Instance;
            if (loader == null || loader.CurrentModel == null) return;
            if (_cam == null) _cam = Camera.main;
            if (_cam == null) return;

            var mouse = Input.mousePosition;
            var renderers = loader.CurrentModel.GetComponentsInChildren<Renderer>(true);
            var hit = false;
            foreach (var r in renderers)
            {
                if (!r.enabled) continue;
                if (!ScreenRectOf(r.bounds).Contains(mouse)) continue;
                hit = true;
                break;
            }
            if (!hit) return;

            if (_idle == null) _idle = FindFirstObjectByType<HqIdleMotion>();
            _idle?.Startle(1f);
            Debug.Log("[HqPetPoke] 戳头反应已触发");
        }

        private Rect ScreenRectOf(Bounds bounds)
        {
            var center = _cam.WorldToScreenPoint(bounds.center);
            var extent = bounds.extents;
            var corners = new[]
            {
                _cam.WorldToScreenPoint(bounds.center + new Vector3(extent.x, extent.y, extent.z)),
                _cam.WorldToScreenPoint(bounds.center + new Vector3(-extent.x, -extent.y, extent.z)),
                _cam.WorldToScreenPoint(bounds.center + new Vector3(extent.x, -extent.y, -extent.z)),
                _cam.WorldToScreenPoint(bounds.center + new Vector3(-extent.x, extent.y, -extent.z)),
            };
            var min = center;
            var max = center;
            foreach (var c in corners)
            {
                min = Vector3.Min(min, c);
                max = Vector3.Max(max, c);
            }
            return new Rect(min.x, min.y, Mathf.Max(1f, max.x - min.x), Mathf.Max(1f, max.y - min.y));
        }
    }
}
