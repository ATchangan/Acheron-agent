using System.Collections;
using UniVRM10;
using UnityEngine;

namespace HqPet
{
    /// <summary>
    /// 程序化待机: 呼吸 + 身体微摆 + 随机头部小动作 + 眨眼 + 惊跳反应。
    /// 直接驱动人形骨骼(无 AnimatorController 时可行), 弹簧骨在 LateUpdate 自动响应摆动。
    /// </summary>
    public class HqIdleMotion : MonoBehaviour
    {
        [Header("待机参数")]
        public float breathRateHz = 0.24f;
        public float breathDeg = 0.8f;
        public float swayDeg = 2.0f;
        public float swayRateHz = 0.06f;
        public float microMoveMin = 3f;
        public float microMoveMax = 8f;
        public float blinkInterval = 3.5f;

        private Transform _head, _spine, _chest, _hips;
        private Vrm10Instance _vrm;
        private Quaternion _headBase, _spineBase, _chestBase, _hipsBase;
        private bool _bound;
        private float _nextMicroAt;
        private float _microUntil;
        private float _microYawTarget;
        private float _nextBlinkAt;
        private float _blinkStart = -1f;
        private float _startleUntil;

        private void Start()
        {
            var loader = HqPetLoader.Instance;
            if (loader == null) return;
            if (loader.CurrentModel != null) Bind(loader.CurrentModel);
            else StartCoroutine(WaitForModel(loader));
        }

        private IEnumerator WaitForModel(HqPetLoader loader)
        {
            while (loader.CurrentModel == null) yield return null;
            Bind(loader.CurrentModel);
        }

        public void Bind(GameObject model)
        {
            if (model == null) return;
            _vrm = model.GetComponent<Vrm10Instance>() ?? model.GetComponentInChildren<Vrm10Instance>();
            var animator = model.GetComponentInChildren<Animator>();
            _head = Bone(animator, HumanBodyBones.Head) ?? FindBone(model.transform, "Head");
            _chest = Bone(animator, HumanBodyBones.Chest) ?? FindBone(model.transform, "Chest");
            _spine = Bone(animator, HumanBodyBones.Spine) ?? FindBone(model.transform, "Spine");
            _hips = Bone(animator, HumanBodyBones.Hips) ?? FindBone(model.transform, "Hips");
            _headBase = _head ? _head.localRotation : Quaternion.identity;
            _spineBase = _spine ? _spine.localRotation : Quaternion.identity;
            _chestBase = _chest ? _chest.localRotation : Quaternion.identity;
            _hipsBase = _hips ? _hips.localRotation : Quaternion.identity;
            _nextMicroAt = Time.time + Random.Range(2f, 5f);
            _nextBlinkAt = Time.time + blinkInterval;
            _bound = _head != null || _spine != null || _hips != null;
            Debug.Log($"[HqIdle] 已绑定待机骨骼 bound={_bound} vrm={(_vrm != null)}");
        }

        /// <summary>戳头/点击触发的惊跳反应。</summary>
        public void Startle(float strength = 1f)
        {
            _startleUntil = Time.time + 0.55f * Mathf.Clamp(strength, 0.2f, 2f);
            BlinkOn();
        }

        private void Update()
        {
            if (!_bound) return;
            var t = Time.time;
            var breath = Mathf.Sin(t * Mathf.PI * 2f * breathRateHz) * breathDeg;
            var swayX = Mathf.Sin(t * Mathf.PI * 2f * swayRateHz) * swayDeg;
            var swayZ = Mathf.Cos(t * Mathf.PI * 2f * swayRateHz * 0.73f) * swayDeg * 0.6f;

            if (_hips) _hips.localRotation = _hipsBase * Quaternion.Euler(swayX * 0.35f, 0f, swayZ * 0.35f);
            if (_spine) _spine.localRotation = _spineBase * Quaternion.Euler(swayX * 0.5f + breath, 0f, swayZ * 0.5f);
            if (_chest) _chest.localRotation = _chestBase * Quaternion.Euler(breath * 0.6f, 0f, 0f);

            // 随机头部小动作
            if (t >= _nextMicroAt)
            {
                _microUntil = t + Random.Range(0.8f, 1.8f);
                _microYawTarget = Random.Range(-7f, 7f);
                _nextMicroAt = t + Random.Range(microMoveMin, microMoveMax);
            }
            var headYaw = 0f;
            var headPitch = 0f;
            if (t < _microUntil)
            {
                var dur = 1.6f;
                var k = Mathf.Sin(Mathf.Clamp01((t - (_microUntil - dur)) / dur) * Mathf.PI);
                headYaw = Mathf.Clamp(_microYawTarget * k, -8f, 8f);
            }
            if (t < _startleUntil)
            {
                var k = Mathf.Sin(Mathf.Clamp01((_startleUntil - t) / 0.55f) * Mathf.PI);
                headPitch += 10f * k;
            }
            if (_head) _head.localRotation = _headBase * Quaternion.Euler(headPitch, headYaw, 0f);

            // 眨眼
            if (t >= _nextBlinkAt)
            {
                BlinkOn();
                _nextBlinkAt = t + blinkInterval + Random.Range(0f, 1.5f);
            }
            if (_blinkStart >= 0f && t - _blinkStart > 0.13f) BlinkOff();
        }

        private void BlinkOn()
        {
            _blinkStart = Time.time;
            SetBlink(1f);
        }

        private void BlinkOff()
        {
            _blinkStart = -1f;
            SetBlink(0f);
        }

        private void SetBlink(float weight)
        {
            if (_vrm == null || _vrm.Runtime == null) return;
            try
            {
                var key = ExpressionKey.CreateFromPreset(ExpressionPreset.blink);
                _vrm.Runtime.Expression.SetWeight(key, weight);
            }
            catch
            {
                // 模型没有 blink 表达式时忽略
            }
        }

        private static Transform Bone(Animator animator, HumanBodyBones bone)
        {
            if (animator != null && animator.avatar != null && animator.avatar.isHuman)
                return animator.GetBoneTransform(bone);
            return null;
        }

        private static Transform FindBone(Transform root, string name)
        {
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
            {
                if (t.name == name) return t;
            }
            return null;
        }
    }
}
