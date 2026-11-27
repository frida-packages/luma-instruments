#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <IOSurface/IOSurface.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <mach/mach_time.h>

static io_connect_t open_surface_root (void);
static void make_surface (void);
static void call_unknown_selectors (io_connect_t connection, mach_port_t wake_port);
static void read_platform (void);
static void list_usb_devices (void);
static void open_map_and_close (void);
static void call_in_a_burst (io_connect_t connection, unsigned int count);

int
main (int argc, char * argv[])
{
  io_connect_t standing;
  IONotificationPortRef notifications;
  unsigned int burst, tick;

  burst = (argc > 1) ? atoi (argv[1]) : 0;

  standing = open_surface_root ();
  notifications = IONotificationPortCreate (kIOMainPortDefault);
  printf ("pid %d, standing connection 0x%x\n", getpid (), standing);
  fflush (stdout);

  for (tick = 1; ; tick++)
  {
    sleep (1);
    make_surface ();
    call_unknown_selectors (standing, IONotificationPortGetMachPort (notifications));
    read_platform ();
    list_usb_devices ();
    if (tick % 3 == 0)
      open_map_and_close ();
    if (burst != 0)
      call_in_a_burst (standing, burst);
  }

  return 0;
}

static io_connect_t
open_surface_root (void)
{
  io_service_t service;
  io_connect_t connection = MACH_PORT_NULL;

  service = IOServiceGetMatchingService (kIOMainPortDefault, IOServiceMatching ("IOSurfaceRoot"));
  IOServiceOpen (service, mach_task_self (), 0, &connection);
  IOObjectRelease (service);

  return connection;
}

static void
make_surface (void)
{
  int width = 64, height = 64, bytes_per_element = 4;
  CFNumberRef numbers[3];
  const void * keys[3] = { kIOSurfaceWidth, kIOSurfaceHeight, kIOSurfaceBytesPerElement };
  CFDictionaryRef properties;
  IOSurfaceRef surface;

  numbers[0] = CFNumberCreate (NULL, kCFNumberIntType, &width);
  numbers[1] = CFNumberCreate (NULL, kCFNumberIntType, &height);
  numbers[2] = CFNumberCreate (NULL, kCFNumberIntType, &bytes_per_element);
  properties = CFDictionaryCreate (NULL, keys, (const void **) numbers, 3, &kCFTypeDictionaryKeyCallBacks,
      &kCFTypeDictionaryValueCallBacks);

  surface = IOSurfaceCreate (properties);
  IOSurfaceLock (surface, 0, NULL);
  IOSurfaceUnlock (surface, 0, NULL);
  CFRelease (surface);

  CFRelease (properties);
  CFRelease (numbers[0]);
  CFRelease (numbers[1]);
  CFRelease (numbers[2]);
}

static void
call_unknown_selectors (io_connect_t connection, mach_port_t wake_port)
{
  uint64_t input[2] = { 1, 0xfffffffffffffff0ULL };
  uint64_t reference[8] = { 0, };
  uint8_t blob[300];

  memset (blob, 0xab, sizeof (blob));
  IOConnectCallMethod (connection, 9999, input, 2, blob, sizeof (blob), NULL, NULL, NULL, NULL);
  IOConnectCallAsyncScalarMethod (connection, 9998, wake_port, reference, 8, input, 1, NULL, NULL);
  IOConnectCallScalarMethod (connection, 9997, input, 2, NULL, NULL);
  IOConnectCallStructMethod (connection, 9996, blob, 16, NULL, NULL);
}

static void
read_platform (void)
{
  io_service_t platform;
  io_registry_entry_t root;
  CFTypeRef value;
  CFMutableDictionaryRef properties;

  platform = IOServiceGetMatchingService (kIOMainPortDefault, IOServiceMatching ("IOPlatformExpertDevice"));
  value = IORegistryEntryCreateCFProperty (platform, CFSTR ("IOPlatformUUID"), NULL, 0);
  CFRelease (value);
  value = IORegistryEntrySearchCFProperty (platform, kIOServicePlane, CFSTR ("model"), NULL, kIORegistryIterateRecursively);
  CFRelease (value);
  IORegistryEntryCreateCFProperties (platform, &properties, NULL, 0);
  CFRelease (properties);
  IOObjectRelease (platform);

  root = IORegistryEntryFromPath (kIOMainPortDefault, "IOService:/");
  IOObjectRelease (root);
}

static void
list_usb_devices (void)
{
  io_iterator_t iterator;
  io_object_t device;

  IOServiceGetMatchingServices (kIOMainPortDefault, IOServiceMatching ("IOUSBHostDevice"), &iterator);
  while ((device = IOIteratorNext (iterator)) != 0)
    IOObjectRelease (device);
  IOObjectRelease (iterator);
}

static void
open_map_and_close (void)
{
  io_connect_t connection;
  mach_vm_address_t address = 0;
  mach_vm_size_t size = 0;

  connection = open_surface_root ();
  IOConnectMapMemory64 (connection, 0, mach_task_self (), &address, &size, kIOMapAnywhere);
  IOServiceClose (connection);
}

static void
call_in_a_burst (io_connect_t connection, unsigned int count)
{
  mach_timebase_info_data_t timebase;
  uint64_t input[2] = { 1, 2 }, start;
  uint8_t blob[64] = { 0, };
  unsigned int i;

  mach_timebase_info (&timebase);
  start = mach_absolute_time ();
  for (i = 0; i != count; i++)
    IOConnectCallMethod (connection, 9999, input, 2, blob, sizeof (blob), NULL, NULL, NULL, NULL);
  printf ("%u calls in %.2f ms\n", count,
      (double) (mach_absolute_time () - start) * timebase.numer / timebase.denom / 1e6);
  fflush (stdout);
}
