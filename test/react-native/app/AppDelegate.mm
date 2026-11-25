#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@implementation AppDelegate {
  NSView *_rootView;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"RNSpyApp";
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];
  self.automaticallyLoadReactNativeWindow = NO;
  [super applicationDidFinishLaunching:notification];
  _rootView = [self.rootViewFactory viewWithModuleName:self.moduleName initialProperties:self.initialProps launchOptions:notification.userInfo];
  _rootView.frame = NSMakeRect(0, 0, 640, 480);
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
}

@end
