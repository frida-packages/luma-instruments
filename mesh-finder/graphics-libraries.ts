export const metalLibraries = {
    framework: /^Metal$/,
};

export const vulkanLibraries = {
    loader: /^(libvulkan\.so(\.\d+)*|vulkan-1\.dll)$/i,
    mappedDeviceMemory: /^(\/dev\/dri\/|anon_inode:i915\.gem$)/,
};

export const openGLLibraries = {
    darwin: /^libGL\.dylib$/,
    linux: {
        api: /^lib(GL|OpenGL|GLESv2|GLESv3)\.so(\.\d+)*$/,
        contexts: [
            { library: /^libEGL\.so(\.\d+)*$/, currentContext: "eglGetCurrentContext", procAddress: "eglGetProcAddress" },
            { library: /^libGLX?\.so(\.\d+)*$/, currentContext: "glXGetCurrentContext", procAddress: "glXGetProcAddressARB" },
        ],
        triggers: /^lib(GL|OpenGL|GLESv2|GLESv3|EGL|GLX)\.so(\.\d+)*$/,
    },
};
