import { Menu, Tray, nativeImage } from 'electron';
import { TRAY_ICON_16, TRAY_ICON_32 } from './icon';

/** Axon's tray icon: a click opens the office; the menu also opens today's plan or quits. */
export function createTray(actions: { open(): void; today(): void; quit(): void }): Tray {
  const image = nativeImage.createEmpty();
  image.addRepresentation({ scaleFactor: 1, dataURL: TRAY_ICON_16 });
  image.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_32 });
  const tray = new Tray(image);
  tray.setToolTip('Axon');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Axon', click: actions.open },
      { label: 'Today’s plan', click: actions.today },
      { type: 'separator' },
      { label: 'Quit', click: actions.quit }
    ])
  );
  tray.on('click', actions.open);
  return tray;
}
