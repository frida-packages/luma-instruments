import React, { useEffect, useState } from 'react';
import { Appearance, AppState, NativeModules, Text, View } from 'react-native';

declare const global: { spyAppTicks?: number; spyAppMarker?: string; spyAppProbe?: () => unknown };

const port = 8765;

global.spyAppTicks = 0;
global.spyAppMarker = 'initial';
global.spyAppProbe = () => ({ ticks: global.spyAppTicks, marker: global.spyAppMarker });

function tick(): void {
  global.spyAppTicks = (global.spyAppTicks ?? 0) + 1;
  Appearance.getColorScheme();
  AppState.addEventListener('change', () => {}).remove();
  fetch(`http://127.0.0.1:${port}/tick?n=${global.spyAppTicks}`, { headers: { 'X-Spy-App': 'yes' } })
    .then(response => response.text())
    .then(text => console.log(`spy-app fetched ${text}`))
    .catch(error => console.log(`spy-app fetch failed ${error}`));
}

export default function App(): React.JSX.Element {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      tick();
      setTicks(global.spyAppTicks ?? 0);
    }, 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <View>
      <Text>{`ticks ${ticks} ${NativeModules.SourceCode?.getConstants?.().scriptURL ?? ''}`}</Text>
    </View>
  );
}
