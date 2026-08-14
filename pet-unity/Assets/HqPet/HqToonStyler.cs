using UnityEngine;

namespace HqPet
{
    /// <summary>
    /// 黄泉桌宠材质风格化: 把 VRM10 导入后的 Standard 材质换成自研 HqToon 赛璐璐着色
    /// (两段明暗 + 描边 + 边缘光 + 高光, 伪主光不依赖场景灯光绑定, 透明窗口下稳定)。
    /// 同时按贴图实际 Alpha 修正渲染模式: PMX 导出时几乎把所有材质都标成了 BLEND,
    /// 是此前闪烁/重影/Z-Fighting 的根因。
    /// </summary>
    public static class HqToonStyler
    {
        public const string ShaderName = "HqPet/HqToon";

        private static readonly int PID_MainTex = Shader.PropertyToID("_MainTex");
        private static readonly int PID_Color = Shader.PropertyToID("_Color");
        private static readonly int PID_ShadeColor = Shader.PropertyToID("_ShadeColor");
        private static readonly int PID_ShadeThreshold = Shader.PropertyToID("_ShadeThreshold");
        private static readonly int PID_ShadeSoftness = Shader.PropertyToID("_ShadeSoftness");
        private static readonly int PID_FakeLightDir = Shader.PropertyToID("_FakeLightDir");
        private static readonly int PID_FakeLightColor = Shader.PropertyToID("_FakeLightColor");
        private static readonly int PID_AmbientColor = Shader.PropertyToID("_AmbientColor");
        private static readonly int PID_SpecColor = Shader.PropertyToID("_HqSpecColor");
        private static readonly int PID_SpecPower = Shader.PropertyToID("_SpecPower");
        private static readonly int PID_SpecIntensity = Shader.PropertyToID("_SpecIntensity");
        private static readonly int PID_RimColor = Shader.PropertyToID("_RimColor");
        private static readonly int PID_RimPower = Shader.PropertyToID("_RimPower");
        private static readonly int PID_RimMix = Shader.PropertyToID("_RimMix");
        private static readonly int PID_EmissionColor = Shader.PropertyToID("_EmissionColor");
        private static readonly int PID_OutlineColor = Shader.PropertyToID("_OutlineColor");
        private static readonly int PID_OutlineWidth = Shader.PropertyToID("_OutlineWidth");
        private static readonly int PID_Cutoff = Shader.PropertyToID("_Cutoff");
        private static readonly int PID_AlphaMode = Shader.PropertyToID("_AlphaMode");
        private static readonly int PID_Cull = Shader.PropertyToID("_Cull");
        private static readonly int PID_SrcBlend = Shader.PropertyToID("_SrcBlend");
        private static readonly int PID_DstBlend = Shader.PropertyToID("_DstBlend");
        private static readonly int PID_ZWrite = Shader.PropertyToID("_ZWrite");

        private enum AlphaKind
        {
            Opaque,
            Cutout,
            Blend,
        }

        public static void Apply(GameObject root)
        {
            var shader = ResolveShader();
            if (shader == null)
            {
                Debug.LogError($"[HqToon] 找不到 shader: {ShaderName}");
                return;
            }

            var renderers = root.GetComponentsInChildren<Renderer>(true);
            var styled = 0;
            var debugLogged = false;
            foreach (var r in renderers)
            {
                var mats = r.sharedMaterials;
                var changed = false;
                for (var i = 0; i < mats.Length; i++)
                {
                    var src = mats[i];
                    if (src == null || (src.shader != null && src.shader.name == ShaderName)) continue;
                    mats[i] = Stylize(src, shader);
                    changed = true;
                    styled++;
                }
                if (changed) r.sharedMaterials = mats;
                if (!debugLogged && r.sharedMaterials.Length > 0 && r.sharedMaterials[0] != null)
                {
                    var mm = r.sharedMaterials[0];
                    Debug.Log($"[HqToon] shader={mm.shader.name} supported={mm.shader.isSupported} color={mm.GetColor(PID_Color)} mainTex={mm.GetTexture(PID_MainTex) != null}");
                    debugLogged = true;
                }
            }
            Debug.Log($"[HqToon] 已应用 HqToon 到 {styled} 个材质");
        }

        private static Shader ResolveShader()
        {
            // 优先按名字查找(Always Included 已保证进包), 场景引用只作兜底,
            // 避免场景里序列化的 shader 引用过期导致用错 shader。
            var byName = Shader.Find(ShaderName);
            if (byName != null) return byName;
            var holder = Object.FindFirstObjectByType<HqToonShaderRef>();
            if (holder != null && holder.shader != null) return holder.shader;
            return null;
        }

        private static Material Stylize(Material src, Shader shader)
        {
            var m = new Material(shader) { name = src.name + "_HqToon" };

            if (src.HasProperty(PID_MainTex))
            {
                var mainTex = src.GetTexture(PID_MainTex);
                if (mainTex != null) m.SetTexture(PID_MainTex, mainTex);
            }
            m.SetColor(PID_Color, Color.white);

            var name = src.name;
            var lower = name.ToLowerInvariant();
            var alpha = ClassifyAlpha(lower);
            ApplyAlpha(m, alpha);
            ApplyCategory(m, lower);
            ApplyQueue(m, lower, alpha);

            if (Application.isPlaying) Object.Destroy(src);
            return m;
        }

        private static AlphaKind ClassifyAlpha(string lower)
        {
            if (ContainsAny(lower, "biaoq", "bq", "表情")) return AlphaKind.Blend;
            if (lower.Contains("+") || ContainsAny(lower, "衣内", "花")) return AlphaKind.Cutout;
            return AlphaKind.Opaque;
        }

        private static void ApplyAlpha(Material m, AlphaKind kind)
        {
            m.DisableKeyword("_ALPHATEST_ON");
            m.DisableKeyword("_ALPHABLEND_ON");
            m.SetFloat(PID_Cull, 2f);

            switch (kind)
            {
                case AlphaKind.Cutout:
                    m.SetFloat(PID_AlphaMode, 1f);
                    m.SetFloat(PID_Cutoff, 0.5f);
                    m.EnableKeyword("_ALPHATEST_ON");
                    m.SetFloat(PID_SrcBlend, 1f);
                    m.SetFloat(PID_DstBlend, 0f);
                    m.SetFloat(PID_ZWrite, 1f);
                    break;
                case AlphaKind.Blend:
                    m.SetFloat(PID_AlphaMode, 2f);
                    m.SetFloat(PID_Cutoff, 0.05f);
                    m.EnableKeyword("_ALPHABLEND_ON");
                    m.SetFloat(PID_SrcBlend, 5f);
                    m.SetFloat(PID_DstBlend, 10f);
                    m.SetFloat(PID_ZWrite, 0f);
                    break;
                default:
                    m.SetFloat(PID_AlphaMode, 0f);
                    m.SetFloat(PID_Cutoff, 0.5f);
                    m.SetFloat(PID_SrcBlend, 1f);
                    m.SetFloat(PID_DstBlend, 0f);
                    m.SetFloat(PID_ZWrite, 1f);
                    break;
            }
        }

        private static void ApplyCategory(Material m, string lower)
        {
            // 全局: 伪主光从左上打下来, 环境光兜底避免发黑
            m.SetVector(PID_FakeLightDir, new Vector4(0.45f, 0.82f, 0.55f, 0f));
            m.SetColor(PID_FakeLightColor, new Color(1.0f, 1.0f, 1.02f, 1f));
            m.SetColor(PID_AmbientColor, new Color(0.45f, 0.47f, 0.54f, 1f));
            m.SetColor(PID_EmissionColor, Color.black);

            var outlineWidth = 0.0032f;
            var outlineColor = new Color(0.08f, 0.07f, 0.13f, 1f);

            if (IsFace(lower))
            {
                // 脸/身体: 明亮, 阴影带一点暖色
                m.SetColor(PID_ShadeColor, new Color(0.84f, 0.78f, 0.82f, 1f));
                m.SetFloat(PID_ShadeThreshold, 0.08f);
                m.SetFloat(PID_ShadeSoftness, 0.16f);
                m.SetFloat(PID_SpecIntensity, 0f);
                m.SetColor(PID_RimColor, new Color(0.34f, 0.34f, 0.42f, 1f));
                m.SetFloat(PID_RimPower, 6f);
                m.SetFloat(PID_RimMix, 0.12f);
                outlineWidth = 0.0026f;
            }
            else if (IsFaceOverlay(lower))
            {
                // 眼/眉/口/睫: 接近不受光, 保持线条清晰
                m.SetColor(PID_ShadeColor, new Color(0.95f, 0.93f, 0.98f, 1f));
                m.SetFloat(PID_ShadeThreshold, -0.6f);
                m.SetFloat(PID_ShadeSoftness, 0.2f);
                m.SetFloat(PID_SpecIntensity, 0f);
                m.SetFloat(PID_RimMix, 0f);
                outlineWidth = 0.0024f;
            }
            else if (IsHair(lower))
            {
                // 发: 蓝紫色相贴近官方(略偏紫), 阴影提亮, 保留明显高光与边缘光
                m.SetColor(PID_Color, new Color(1.02f, 0.95f, 0.99f, 1f));
                m.SetColor(PID_ShadeColor, new Color(0.46f, 0.43f, 0.62f, 1f));
                m.SetFloat(PID_ShadeThreshold, 0.04f);
                m.SetFloat(PID_ShadeSoftness, 0.12f);
                m.SetColor(PID_SpecColor, new Color(0.90f, 0.93f, 1.0f, 1f));
                m.SetFloat(PID_SpecPower, 38f);
                m.SetFloat(PID_SpecIntensity, 0.45f);
                m.SetColor(PID_RimColor, new Color(0.58f, 0.54f, 0.78f, 1f));
                m.SetFloat(PID_RimPower, 5f);
                m.SetFloat(PID_RimMix, 0.45f);
                outlineWidth = 0.0036f;
            }
            else if (IsCloth(lower))
            {
                // 衣/裤/靴/袖: 冷蓝黑阴影
                m.SetColor(PID_ShadeColor, new Color(0.30f, 0.33f, 0.44f, 1f));
                m.SetFloat(PID_ShadeThreshold, 0.05f);
                m.SetFloat(PID_ShadeSoftness, 0.2f);
                m.SetColor(PID_SpecColor, new Color(0.75f, 0.78f, 0.88f, 1f));
                m.SetFloat(PID_SpecPower, 48f);
                m.SetFloat(PID_SpecIntensity, 0.08f);
                m.SetColor(PID_RimColor, new Color(0.28f, 0.32f, 0.46f, 1f));
                m.SetFloat(PID_RimPower, 6f);
                m.SetFloat(PID_RimMix, 0.25f);
            }
            else
            {
                // 金属/宝石/头饰
                m.SetColor(PID_ShadeColor, new Color(0.46f, 0.48f, 0.60f, 1f));
                m.SetFloat(PID_ShadeThreshold, 0.03f);
                m.SetFloat(PID_ShadeSoftness, 0.18f);
                m.SetColor(PID_SpecColor, new Color(0.95f, 0.97f, 1.0f, 1f));
                m.SetFloat(PID_SpecPower, 30f);
                m.SetFloat(PID_SpecIntensity, 0.28f);
                m.SetColor(PID_RimColor, new Color(0.36f, 0.40f, 0.55f, 1f));
                m.SetFloat(PID_RimPower, 5f);
                m.SetFloat(PID_RimMix, 0.30f);
            }

            m.SetColor(PID_OutlineColor, outlineColor);
            m.SetFloat(PID_OutlineWidth, lower.Contains("biaoq") ? 0f : outlineWidth);
        }

        private static void ApplyQueue(Material m, string lower, AlphaKind alpha)
        {
            if (alpha == AlphaKind.Blend)
            {
                m.renderQueue = 3000;
                return;
            }
            if (alpha == AlphaKind.Cutout)
            {
                m.renderQueue = 2450;
                return;
            }

            var queue = 2000;
            if (lower.Contains("白目")) queue = 2001;
            else if (lower.Contains("目光")) queue = 2003;
            else if (lower.Contains("睫")) queue = 2004;
            else if (lower.Contains("眉")) queue = 2005;
            else if (lower.Contains("口")) queue = 2006;
            else if (lower.Contains("齿") || lower.Contains("歯")) queue = 2007;
            else if (lower.Contains("目影")) queue = 2008;
            else if (lower.Contains("目")) queue = 2002;
            m.renderQueue = queue;
        }

        private static bool IsFace(string lower)
        {
            return ContainsAny(lower, "颜", "顔", "体", "face", "skin", "肌", "body");
        }

        private static bool IsFaceOverlay(string lower)
        {
            return ContainsAny(lower, "白目", "目", "睫", "眉", "口", "齿", "歯", "brow", "eye", "lash", "mouth", "teeth");
        }

        private static bool IsHair(string lower)
        {
            return ContainsAny(lower, "发", "髪", "hair", "后发", "前发");
        }

        private static bool IsCloth(string lower)
        {
            return ContainsAny(lower, "衣", "裤", "裙", "靴", "手套", "袖", "腰", "背脊", "clot", "dress", "skirt", "sleeve", "pants", "shoe", "boot", "glove", "花");
        }

        private static bool ContainsAny(string value, params string[] keys)
        {
            foreach (var k in keys)
            {
                if (value.Contains(k)) return true;
            }
            return false;
        }
    }
}
