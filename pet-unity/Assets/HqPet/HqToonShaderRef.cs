using UnityEngine;

namespace HqPet
{
    /// <summary>
    /// 在场景里持有 MToon10 shader 引用, 保证 shader 与变体被打进 Player,
    /// 运行时 HqToonStyler 也能稳定 Find 到。
    /// </summary>
    public class HqToonShaderRef : MonoBehaviour
    {
        public Shader shader;
    }
}
