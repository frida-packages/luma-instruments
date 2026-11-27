#pragma abi native

struct SubresourceLayout {
    u64 offset;
    u64 size;
    u64 rowPitch;
    u64 arrayPitch;
    u64 depthPitch;
};
