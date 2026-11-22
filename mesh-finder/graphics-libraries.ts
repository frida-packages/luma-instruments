export const metalLibraries = {
    framework: /^Metal$/,
};

export const vulkanLibraries = {
    loader: /^(libvulkan\.so(\.\d+)*|vulkan-1\.dll)$/i,
    mappedDeviceMemory: /^(\/dev\/dri\/|anon_inode:i915\.gem$)/,
};

export const openGLLibraries = {
    darwin: /^libGL\.dylib$/,
};
