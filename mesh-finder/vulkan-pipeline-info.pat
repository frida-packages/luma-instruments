#pragma abi native

struct BaseInStructure {
    u32 sType;
    u8 *next;
};

struct PipelineShaderStageCreateInfo {
    u32 sType;
    u8 *next;
    u32 flags;
    u32 stage;
    u8 *module;
    char *name;
    u8 *specializationInfo;
};

struct PipelineVertexInputStateCreateInfo {
    u32 sType;
    u8 *next;
    u32 flags;
    u32 vertexBindingDescriptionCount;
    u8 *vertexBindingDescriptions;
    u32 vertexAttributeDescriptionCount;
    u8 *vertexAttributeDescriptions;
};

struct PipelineInputAssemblyStateCreateInfo {
    u32 sType;
    u8 *next;
    u32 flags;
    u32 topology;
    u32 primitiveRestartEnable;
};

struct PipelineDynamicStateCreateInfo {
    u32 sType;
    u8 *next;
    u32 flags;
    u32 dynamicStateCount;
    u8 *dynamicStates;
};

struct GraphicsPipelineCreateInfo {
    u32 sType;
    u8 *next;
    u32 flags;
    u32 stageCount;
    u8 *stages;
    PipelineVertexInputStateCreateInfo *vertexInputState;
    PipelineInputAssemblyStateCreateInfo *inputAssemblyState;
    u8 *tessellationState;
    u8 *viewportState;
    u8 *rasterizationState;
    u8 *multisampleState;
    u8 *depthStencilState;
    u8 *colorBlendState;
    PipelineDynamicStateCreateInfo *dynamicState;
    u8 *layout;
    u8 *renderPass;
    u32 subpass;
    u8 *basePipelineHandle;
    s32 basePipelineIndex;
};

struct PipelineLibraryCreateInfo {
    u32 sType;
    u8 *next;
    u32 libraryCount;
    u8 *libraries;
};

struct ShaderModuleCreateInfo {
    u32 sType;
    u8 *next;
    u32 flags;
    u64 codeSize;
    u8 *code;
};
