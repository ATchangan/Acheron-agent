Shader "HqPet/HqToon"
{
    Properties
    {
        [MainTexture] _MainTex ("Base Map", 2D) = "white" {}
        _Color ("Base Color", Color) = (1,1,1,1)

        // 二次元两段明暗: 亮部 = 贴图, 暗部 = 贴图 * ShadeColor
        _ShadeColor ("Shade Color", Color) = (0.48,0.50,0.62,1)
        _ShadeThreshold ("Shade Threshold", Range(-1,1)) = 0.02
        _ShadeSoftness ("Shade Softness", Range(0.001,1)) = 0.18

        // 伪主光(方向固定, 不依赖场景灯光绑定, 保证桌面透明窗口下稳定)
        _FakeLightDir ("Fake Light Dir (world)", Vector) = (0.45,0.82,0.55,0)
        _FakeLightColor ("Fake Light Color", Color) = (1.0,1.0,1.02,1)
        _AmbientColor ("Ambient Color", Color) = (0.40,0.43,0.50,1)

        // 高光(发丝/金属)
        _HqSpecColor ("Specular Color", Color) = (0.90,0.93,1.0,1)
        _SpecPower ("Specular Power", Range(1,200)) = 42
        _SpecIntensity ("Specular Intensity", Range(0,2)) = 0.30

        // 边缘光
        _RimColor ("Rim Color", Color) = (0.42,0.47,0.70,1)
        _RimPower ("Rim Power", Range(0.5,20)) = 5.5
        _RimMix ("Rim Mix", Range(0,1)) = 0.35

        _EmissionColor ("Emission", Color) = (0,0,0,1)

        // 描边
        _OutlineColor ("Outline Color", Color) = (0.08,0.07,0.13,1)
        _OutlineWidth ("Outline Width (screen)", Range(0,0.02)) = 0.0032

        _Cutoff ("Alpha Cutoff", Range(0,1)) = 0.5
        _AlphaMode ("Alpha Mode (0=opaque 1=cutout 2=blend)", Int) = 0
        _Cull ("Cull", Float) = 2
        [HideInInspector] _SrcBlend ("_SrcBlend", Float) = 1
        [HideInInspector] _DstBlend ("_DstBlend", Float) = 0
        [HideInInspector] _ZWrite ("_ZWrite", Float) = 1
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }

        // 主光着色
        Pass
        {
            Name "FORWARD_BASE"
            Tags { "LightMode"="ForwardBase" }

            Cull [_Cull]
            Blend [_SrcBlend] [_DstBlend]
            ZWrite [_ZWrite]
            ZTest LEqual

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma target 3.0
            #pragma multi_compile __ _ALPHATEST_ON _ALPHABLEND_ON
            #pragma multi_compile_instancing

            #include "UnityCG.cginc"
            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;
            fixed4 _ShadeColor;
            half _ShadeThreshold;
            half _ShadeSoftness;
            half4 _FakeLightDir;
            fixed4 _FakeLightColor;
            fixed4 _AmbientColor;
            fixed4 _HqSpecColor;
            half _SpecPower;
            half _SpecIntensity;
            fixed4 _RimColor;
            half _RimPower;
            half _RimMix;
            fixed4 _EmissionColor;
            half _Cutoff;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 posWS : TEXCOORD2;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.normalWS = UnityObjectToWorldNormal(v.normal);
                o.posWS = mul(unity_ObjectToWorld, v.vertex).xyz;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                fixed4 tex = tex2D(_MainTex, i.uv) * _Color;

            #if defined(_ALPHATEST_ON)
                clip(tex.a - _Cutoff);
            #endif
            #if !defined(_ALPHABLEND_ON)
                tex.a = 1.0;
            #endif

                float3 N = normalize(i.normalWS);
                float3 L = normalize(_FakeLightDir.xyz);
                float3 V = normalize(_WorldSpaceCameraPos - i.posWS);
                float3 H = normalize(L + V);

                half lambert = dot(N, L) * 0.5 + 0.5;
                half shade = smoothstep(_ShadeThreshold - _ShadeSoftness, _ShadeThreshold + _ShadeSoftness, lambert);

                fixed3 albedo = tex.rgb;
                fixed3 shaded = albedo * _ShadeColor.rgb;
                fixed3 base = lerp(shaded, albedo, shade);
                fixed3 col = base * _FakeLightColor.rgb;

                // 固定环境光, 保证透明窗口下不发黑
                col += albedo * _AmbientColor.rgb;

                // 高光
                half spec = pow(max(dot(N, H), 0.0), _SpecPower) * _SpecIntensity;
                col += _HqSpecColor.rgb * _FakeLightColor.rgb * spec;

                // 边缘光
                half rim = pow(1.0 - saturate(dot(N, V)), _RimPower) * _RimMix;
                col += rim * _RimColor.rgb * (_FakeLightColor.rgb + _AmbientColor.rgb);

                col += _EmissionColor.rgb;

                return fixed4(col, tex.a);
            }
            ENDCG
        }

        // 描边(背面壳)
        Pass
        {
            Name "FORWARD_BASE_OUTLINE"
            Tags { "LightMode"="ForwardBase" }

            Cull Front
            Blend [_SrcBlend] [_DstBlend]
            ZWrite Off
            ZTest LEqual

            CGPROGRAM
            #pragma vertex vert_outline
            #pragma fragment frag_outline
            #pragma target 3.0
            #pragma multi_compile __ _ALPHATEST_ON _ALPHABLEND_ON
            #pragma multi_compile_instancing

            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _OutlineColor;
            half _OutlineWidth;
            half _Cutoff;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            v2f vert_outline (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                o.pos = UnityObjectToClipPos(v.vertex);
                float3 normalVS = mul((float3x3)UNITY_MATRIX_IT_MV, v.normal);
                float2 offset = normalize(normalVS.xy);
                o.pos.xy += offset * _OutlineWidth * o.pos.w;
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                return o;
            }

            fixed4 frag_outline (v2f i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
            #if defined(_ALPHATEST_ON)
                clip(tex2D(_MainTex, i.uv).a - _Cutoff);
            #endif
            #if defined(_ALPHABLEND_ON)
                return fixed4(_OutlineColor.rgb, tex2D(_MainTex, i.uv).a);
            #else
                return fixed4(_OutlineColor.rgb, 1);
            #endif
            }
            ENDCG
        }

        // 阴影投射(不需要投影时可裁掉, 保留以防框架要 shadowmap)
        Pass
        {
            Name "SHADOW_CASTER"
            Tags { "LightMode"="ShadowCaster" }
            Cull Off
            ZWrite On
            ZTest LEqual

            CGPROGRAM
            #pragma vertex vert_shadow
            #pragma fragment frag_shadow
            #pragma multi_compile __ _ALPHATEST_ON
            #pragma multi_compile_instancing

            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            half _Cutoff;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                V2F_SHADOW_CASTER;
                float2 uv : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            v2f vert_shadow (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);
                TRANSFER_SHADOW_CASTER_NORMALOFFSET(o)
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                return o;
            }

            fixed4 frag_shadow (v2f i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
            #if defined(_ALPHATEST_ON)
                clip(tex2D(_MainTex, i.uv).a - _Cutoff);
            #endif
                SHADOW_CASTER_FRAGMENT(i)
            }
            ENDCG
        }
    }
    FallBack "Unlit/Texture"
}
