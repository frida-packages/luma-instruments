import { vulkanLibraries } from "./graphics-libraries.js";

export interface VulkanDriver {
    index: number;
    name: string;
    entryPoints: Map<string, NativePointer>;
}

interface CStringArray {
    array: NativePointer;
    strings: NativePointer[];
}

const ICD_ENTRY = "vk_icdGetInstanceProcAddr";
const LOADER_ENTRY = "vkGetInstanceProcAddr";
const LARGEST_DEVICE_COUNT = 8;

const wantedExtensions = {
    instance: ["VK_EXT_debug_utils"],
    device: [
        "VK_EXT_vertex_input_dynamic_state",
        "VK_EXT_extended_dynamic_state",
        "VK_EXT_multi_draw",
        "VK_KHR_maintenance5",
        "VK_KHR_map_memory2",
        "VK_KHR_copy_commands2",
        "VK_KHR_synchronization2",
        "VK_KHR_bind_memory2",
        "VK_KHR_timeline_semaphore",
        "VK_KHR_dynamic_rendering",
    ],
};

const source = `
#include <glib.h>
#include <string.h>

#define SUCCESS 0
#define LARGEST_EXTENSION_COUNT 1024

typedef void (* VoidFunction) (void);
typedef VoidFunction (* GetInstanceProcAddr) (gpointer instance, const gchar * name);
typedef VoidFunction (* GetDeviceProcAddr) (gpointer device, const gchar * name);

typedef struct
{
  gint32 type;
  gconstpointer next;
  const gchar * application_name;
  guint32 application_version;
  const gchar * engine_name;
  guint32 engine_version;
  guint32 api_version;
} ApplicationInfo;

typedef struct
{
  gint32 type;
  gconstpointer next;
  guint32 flags;
  const ApplicationInfo * application;
  guint32 layer_count;
  const gchar * const * layers;
  guint32 extension_count;
  const gchar * const * extensions;
} InstanceCreateInfo;

typedef struct
{
  gint32 type;
  gconstpointer next;
  guint32 flags;
  guint32 family;
  guint32 count;
  const float * priorities;
} QueueCreateInfo;

typedef struct
{
  gint32 type;
  gconstpointer next;
  guint32 flags;
  guint32 queue_info_count;
  const QueueCreateInfo * queue_infos;
  guint32 layer_count;
  const gchar * const * layers;
  guint32 extension_count;
  const gchar * const * extensions;
  gconstpointer features;
} DeviceCreateInfo;

typedef struct
{
  gchar name[256];
  guint32 version;
} ExtensionProperties;

typedef gint32 (* EnumerateInstanceVersion) (guint32 * version);
typedef gint32 (* EnumerateInstanceExtensionProperties) (const gchar * layer, guint32 * count, ExtensionProperties * properties);
typedef gint32 (* CreateInstance) (const InstanceCreateInfo * info, gconstpointer allocator, gpointer * instance);
typedef void (* DestroyInstance) (gpointer instance, gconstpointer allocator);
typedef gint32 (* EnumeratePhysicalDevices) (gpointer instance, guint32 * count, gpointer * devices);
typedef gint32 (* EnumerateDeviceExtensionProperties) (gpointer physical, const gchar * layer, guint32 * count,
    ExtensionProperties * properties);
typedef gint32 (* CreateDevice) (gpointer physical, const DeviceCreateInfo * info, gconstpointer allocator, gpointer * device);
typedef void (* DestroyDevice) (gpointer device, gconstpointer allocator);

static guint supported (const ExtensionProperties * available, guint32 available_count, const gchar * const * wanted,
    guint wanted_count, const gchar ** chosen);

guint resolve_entry_points (GetInstanceProcAddr gipa, const gchar * const * instance_extensions, guint instance_extension_count,
    const gchar * const * device_extensions, guint device_extension_count, const gchar * const * names, guint name_count,
    guint largest_device_count, gpointer * resolved)
{
  EnumerateInstanceVersion enumerate_version = (EnumerateInstanceVersion) gipa (NULL, "vkEnumerateInstanceVersion");
  EnumerateInstanceExtensionProperties enumerate_instance_extensions =
      (EnumerateInstanceExtensionProperties) gipa (NULL, "vkEnumerateInstanceExtensionProperties");
  CreateInstance create_instance = (CreateInstance) gipa (NULL, "vkCreateInstance");
  ExtensionProperties * available = g_new0 (ExtensionProperties, LARGEST_EXTENSION_COUNT);
  const gchar ** chosen = g_new0 (const gchar *, LARGEST_EXTENSION_COUNT);
  guint32 available_count = LARGEST_EXTENSION_COUNT, device_count = 0, i, n;
  ApplicationInfo application = { 0 };
  InstanceCreateInfo instance_info = { 1 };
  gpointer instance = NULL;
  gpointer * physical_devices;
  EnumeratePhysicalDevices enumerate_devices;
  EnumerateDeviceExtensionProperties enumerate_device_extensions;
  CreateDevice create_device;
  DestroyDevice destroy_device;
  GetDeviceProcAddr gdpa;
  DestroyInstance destroy_instance;
  float priority = 1.0f;

  memset (resolved, 0, largest_device_count * name_count * sizeof (gpointer));
  if (create_instance == NULL)
    goto beach;
  application.api_version = (1u << 22);
  if (enumerate_version != NULL)
    enumerate_version (&application.api_version);
  application.application_name = "mesh-finder";
  instance_info.application = &application;
  if (enumerate_instance_extensions != NULL && enumerate_instance_extensions (NULL, &available_count, available) >= SUCCESS)
  {
    instance_info.extension_count = supported (available, available_count, instance_extensions, instance_extension_count, chosen);
    instance_info.extensions = chosen;
  }
  if (create_instance (&instance_info, NULL, &instance) != SUCCESS)
    goto beach;

  enumerate_devices = (EnumeratePhysicalDevices) gipa (instance, "vkEnumeratePhysicalDevices");
  enumerate_device_extensions = (EnumerateDeviceExtensionProperties) gipa (instance, "vkEnumerateDeviceExtensionProperties");
  create_device = (CreateDevice) gipa (instance, "vkCreateDevice");
  gdpa = (GetDeviceProcAddr) gipa (instance, "vkGetDeviceProcAddr");
  destroy_instance = (DestroyInstance) gipa (instance, "vkDestroyInstance");
  physical_devices = g_new0 (gpointer, largest_device_count);
  device_count = largest_device_count;
  if (enumerate_devices (instance, &device_count, physical_devices) < SUCCESS)
    device_count = 0;

  for (i = 0; i != device_count; i++)
  {
    QueueCreateInfo queue_info = { 2, NULL, 0, 0, 1, &priority };
    DeviceCreateInfo device_info = { 3 };
    gpointer device = NULL;

    device_info.queue_info_count = 1;
    device_info.queue_infos = &queue_info;
    available_count = LARGEST_EXTENSION_COUNT;
    if (enumerate_device_extensions (physical_devices[i], NULL, &available_count, available) >= SUCCESS)
    {
      device_info.extension_count = supported (available, available_count, device_extensions, device_extension_count, chosen);
      device_info.extensions = chosen;
    }
    if (create_device (physical_devices[i], &device_info, NULL, &device) != SUCCESS)
      continue;
    for (n = 0; n != name_count; n++)
      resolved[i * name_count + n] = (gpointer) gdpa (device, names[n]);
    destroy_device = (DestroyDevice) gdpa (device, "vkDestroyDevice");
    destroy_device (device, NULL);
  }

  g_free (physical_devices);
  destroy_instance (instance, NULL);

beach:
  g_free (chosen);
  g_free (available);
  return device_count;
}

static guint supported (const ExtensionProperties * available, guint32 available_count, const gchar * const * wanted,
    guint wanted_count, const gchar ** chosen)
{
  guint count = 0, i, j;
  for (i = 0; i != wanted_count; i++)
    for (j = 0; j != available_count; j++)
      if (strcmp (available[j].name, wanted[i]) == 0)
      {
        chosen[count++] = wanted[i];
        break;
      }
  return count;
}
`;

export function findVulkanDrivers(names: string[]): VulkanDriver[] {
    const modules = Process.enumerateModules();
    const icds = modules.flatMap(module => {
        const entry = module.findExportByName(ICD_ENTRY);
        return (entry !== null) ? [{ name: module.name, entry }] : [];
    });
    const loader = modules.find(module => vulkanLibraries.loader.test(module.name));
    const sources = (icds.length !== 0 || loader === undefined)
        ? icds
        : [{ name: `${loader.name}, through the loader`, entry: loader.getExportByName(LOADER_ENTRY) }];
    const resolver = new CModule(source);
    const resolve = new NativeFunction(resolver.resolve_entry_points, "uint",
        ["pointer", "pointer", "uint", "pointer", "uint", "pointer", "uint", "uint", "pointer"]);
    const instanceExtensions = cStrings(wantedExtensions.instance);
    const deviceExtensions = cStrings(wantedExtensions.device);
    const nameList = cStrings(names);
    const drivers: VulkanDriver[] = [];
    for (const { name, entry } of sources) {
        const resolved = Memory.alloc(LARGEST_DEVICE_COUNT * names.length * Process.pointerSize);
        const deviceCount = Math.min(resolve(entry, instanceExtensions.array, wantedExtensions.instance.length, deviceExtensions.array,
            wantedExtensions.device.length, nameList.array, names.length, LARGEST_DEVICE_COUNT, resolved), LARGEST_DEVICE_COUNT);
        const entryPoints = new Map<string, NativePointer>();
        for (let device = 0; device !== deviceCount; device++) {
            names.forEach((entryName, n) => {
                const address = resolved.add((device * names.length + n) * Process.pointerSize).readPointer();
                if (!address.isNull() && !entryPoints.has(entryName)) {
                    entryPoints.set(entryName, address);
                }
            });
        }
        if (entryPoints.size !== 0) {
            drivers.push({ index: drivers.length, name, entryPoints });
        }
    }
    return drivers;
}

function cStrings(values: string[]): CStringArray {
    const strings = values.map(value => Memory.allocUtf8String(value));
    const array = Memory.alloc(Math.max(values.length, 1) * Process.pointerSize);
    strings.forEach((string, i) => array.add(i * Process.pointerSize).writePointer(string));
    return { array, strings };
}
