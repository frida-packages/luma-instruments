#pragma abi native

struct VertexInputBindingDescription {
    u32 binding;
    u32 stride;
    u32 inputRate;
};

struct VertexInputAttributeDescription {
    u32 location;
    u32 binding;
    u32 format;
    u32 offset;
};

struct VertexInputBindingDescription2 {
    u32 sType;
    u8 *next;
    u32 binding;
    u32 stride;
    u32 inputRate;
    u32 divisor;
};

struct VertexInputAttributeDescription2 {
    u32 sType;
    u8 *next;
    u32 location;
    u32 binding;
    u32 format;
    u32 offset;
};
