Shader "HqPet/HqSsaBlit"
{
    Properties
    {
        _MainTex ("Source", 2D) = "white" {}
    }
    SubShader
    {
        Tags { "Queue"="Background" "RenderType"="Opaque" }
        Cull Off
        ZWrite Off
        ZTest Always
        Lighting Off

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float4 _MainTex_TexelSize;

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            // 直接输出裁剪空间坐标, 无视相机矩阵, 保证全屏
            v2f vert (appdata v)
            {
                v2f o;
                o.pos = float4(v.vertex.xy, 0.0, 1.0);
                o.uv = v.uv;
                return o;
            }

            // 品红/近品红(模型边缘与背景的混合)视为背景, 不参与平均,
            // 这样降采样后边缘是干净的模型色, 再被颜色键精确挖空
            half IsBackground(half3 c)
            {
                return step(0.9, c.r + c.b - 2.0 * c.g) * step(0.45, c.r) * step(0.45, c.b);
            }

            fixed4 frag (v2f i) : SV_Target
            {
                float2 t = _MainTex_TexelSize.xy;
                half3 acc = half3(0, 0, 0);
                half wsum = 0;
                float2 offs[4] = {
                    float2(-0.5, -0.5), float2(0.5, -0.5),
                    float2(-0.5, 0.5), float2(0.5, 0.5)
                };
                for (int k = 0; k < 4; k++)
                {
                    half3 s = tex2D(_MainTex, i.uv + offs[k] * t).rgb;
                    half w = 1.0 - IsBackground(s);
                    acc += s * w;
                    wsum += w;
                }
                if (wsum > 0.001)
                    return fixed4(acc / wsum, 1.0);
                return fixed4(1.0, 0.0, 1.0, 1.0); // 背景保持纯品红, 供颜色键挖空
            }
            ENDCG
        }
    }
}
