/**
 * The drawings of the computer icons (CDXC:RemoteMachines 2026-11-12 in the desktop's packages/gx-core/src/computer_icons.rs),
 * copied from the desktop's apps/desktop/assets/titlebar/*.svg so both apps draw the same picture. Generated: keep
 * them equal to those files.
 */

export type ComputerIconDrawing = {
  viewBox: string;
  /** Filled with the colour (the moon); else stroked. */
  filled: boolean;
  strokeWidth: number;
  paths: readonly { d: string; transform?: string }[];
};

export const COMPUTER_ICON_DRAWINGS: Readonly<Record<string, ComputerIconDrawing>> = {
  // device-laptop.svg
  laptop: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M3 19l18 0' },
      { d: 'M5 7a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -8' },
    ],
  },
  // device-desktop.svg
  desktop: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10' },
      { d: 'M7 20h10' },
      { d: 'M9 16v4' },
      { d: 'M15 16v4' },
    ],
  },
  // server.svg
  server: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3' },
      { d: 'M3 15a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -2' },
      { d: 'M7 8l0 .01' },
      { d: 'M7 16l0 .01' },
    ],
  },
  // cloud.svg
  cloud: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      {
        d: 'M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878',
      },
    ],
  },
  // terminal-2.svg
  terminal: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M8 9l3 3l-3 3' },
      { d: 'M13 15l3 0' },
      { d: 'M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12' },
    ],
  },
  // cpu.svg
  cpu: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M5 6a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -12' },
      { d: 'M9 9h6v6h-6l0 -6' },
      { d: 'M3 10h2' },
      { d: 'M3 14h2' },
      { d: 'M10 3v2' },
      { d: 'M14 3v2' },
      { d: 'M21 10h-2' },
      { d: 'M21 14h-2' },
      { d: 'M14 21v-2' },
      { d: 'M10 21v-2' },
    ],
  },
  // database.svg
  database: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M4 6a8 3 0 1 0 16 0a8 3 0 1 0 -16 0' },
      { d: 'M4 6v6a8 3 0 0 0 16 0v-6' },
      { d: 'M4 12v6a8 3 0 0 0 16 0v-6' },
    ],
  },
  // home.svg
  home: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      {
        d: 'M19 8.71l-5.333 -4.148a2.7 2.7 0 0 0 -3.334 0l-5.333 4.148a2.7 2.7 0 0 0 -1 2.129v7.161a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-7.161a2.7 2.7 0 0 0 -1 -2.129z',
      },
      { d: 'M16 20v-8h-8v8' },
    ],
  },
  // building.svg
  building: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M3 21l18 0' },
      { d: 'M9 8l1 0' },
      { d: 'M9 12l1 0' },
      { d: 'M9 16l1 0' },
      { d: 'M14 8l1 0' },
      { d: 'M14 12l1 0' },
      { d: 'M14 16l1 0' },
      { d: 'M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16' },
    ],
  },
  // briefcase.svg
  briefcase: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9' },
      { d: 'M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2' },
      { d: 'M12 12l0 .01' },
      { d: 'M3 13a20 20 0 0 0 18 0' },
    ],
  },
  // world.svg
  world: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0' },
      { d: 'M3.6 9h16.8' },
      { d: 'M3.6 15h16.8' },
      { d: 'M11.5 3a17 17 0 0 0 0 18' },
      { d: 'M12.5 3a17 17 0 0 1 0 18' },
    ],
  },
  // bolt.svg
  bolt: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [{ d: 'M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11' }],
  },
  // star.svg
  star: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 1.8,
    paths: [
      {
        d: 'M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z',
      },
    ],
  },
  // moon.svg
  moon: {
    viewBox: '0 0 32 32',
    filled: true,
    strokeWidth: 2,
    paths: [
      {
        d: 'M30.4422 21.7576L30.4116 21.7051C30.2498 21.4554 29.954 21.3157 29.6478 21.3697C29.5454 21.3877 29.4525 21.4254 29.3705 21.4785L29.375 21.4756C28.2165 22.2303 26.8137 22.7975 25.2833 23.0673C19.1647 24.1462 13.3295 20.0604 12.2506 13.9418C11.4414 9.3526 13.5372 4.9234 17.2172 2.5401L17.2852 2.4997L17.4776 2.3754C17.72 2.2129 17.8546 1.9221 17.8014 1.6207C17.7363 1.2514 17.4105 0.9931 17.0476 1.0022L17.0435 1.0019C16.3825 1.0139 15.6299 1.0877 14.8745 1.2209C6.8533 2.6353 1.4972 10.2846 2.9116 18.3058C4.3259 26.3271 11.9752 31.6832 19.9965 30.2688C24.6723 29.4443 28.4435 26.5007 30.4942 22.5994L30.5129 22.5615C30.5867 22.4216 30.616 22.254 30.586 22.0836C30.5639 21.9585 30.5128 21.8467 30.4404 21.7529L30.443 21.7564Z',
        transform: 'rotate(-10 16 16)',
      },
    ],
  },
  // leaf.svg
  leaf: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M5 21c.5 -4.5 2.5 -8 7 -10' },
      { d: 'M9 18c6.218 0 10.5 -3.288 11 -12v-2h-4.014c-9 0 -11.986 4 -12 9c0 1 0 3 2 5h3l.014 0' },
    ],
  },
  // rocket.svg
  rocket: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3' },
      { d: 'M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3' },
      { d: 'M14 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0' },
    ],
  },
  // flask.svg
  flask: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M9 3l6 0' },
      { d: 'M10 9l4 0' },
      { d: 'M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6' },
    ],
  },
  // coffee.svg
  coffee: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      {
        d: 'M3 14c.83 .642 2.077 1.017 3.5 1c1.423 .017 2.67 -.358 3.5 -1c.83 -.642 2.077 -1.017 3.5 -1c1.423 -.017 2.67 .358 3.5 1',
      },
      { d: 'M8 3a2.4 2.4 0 0 0 -1 2a2.4 2.4 0 0 0 1 2' },
      { d: 'M12 3a2.4 2.4 0 0 0 -1 2a2.4 2.4 0 0 0 1 2' },
      { d: 'M3 10h14v5a6 6 0 0 1 -6 6h-2a6 6 0 0 1 -6 -6v-5' },
      { d: 'M16.746 16.726a3 3 0 1 0 .252 -5.555' },
    ],
  },
  // brand-windows.svg
  brandWindows: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      {
        d: 'M17.8 20l-12 -1.5c-1 -.1 -1.8 -.9 -1.8 -1.9v-9.2c0 -1 .8 -1.8 1.8 -1.9l12 -1.5c1.2 -.1 2.2 .8 2.2 1.9v12.1c0 1.2 -1.1 2.1 -2.2 1.9l0 .1',
      },
      { d: 'M12 5l0 14' },
      { d: 'M4 12l16 0' },
    ],
  },
  // brand-apple.svg
  brandApple: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      {
        d: 'M8.286 7.008c-3.216 0 -4.286 3.23 -4.286 5.92c0 3.229 2.143 8.072 4.286 8.072c1.165 -.05 1.799 -.538 3.214 -.538c1.406 0 1.607 .538 3.214 .538s4.286 -3.229 4.286 -5.381c-.03 -.011 -2.649 -.434 -2.679 -3.23c-.02 -2.335 2.589 -3.179 2.679 -3.228c-1.096 -1.606 -3.162 -2.113 -3.75 -2.153c-1.535 -.12 -3.032 1.077 -3.75 1.077c-.729 0 -2.036 -1.077 -3.214 -1.077',
      },
      { d: 'M12 4a2 2 0 0 0 2 -2a2 2 0 0 0 -2 2' },
    ],
  },
  // brand-ubuntu.svg
  brandUbuntu: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M10 5a2 2 0 1 0 4 0a2 2 0 1 0 -4 0' },
      {
        d: 'M17.723 7.41a7.992 7.992 0 0 0 -3.74 -2.162m-3.971 0a7.993 7.993 0 0 0 -3.789 2.216m-1.881 3.215a8 8 0 0 0 -.342 2.32c0 .738 .1 1.453 .287 2.132m1.96 3.428a7.993 7.993 0 0 0 3.759 2.19m4 0a7.993 7.993 0 0 0 3.747 -2.186m1.962 -3.43a8.008 8.008 0 0 0 .287 -2.131c0 -.764 -.107 -1.503 -.307 -2.203',
      },
      { d: 'M3 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0' },
      { d: 'M17 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0' },
    ],
  },
  // brand-linux.svg
  brandLinux: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      {
        d: 'M12 3c-2.2 0 -3.5 1.8 -3.5 4c0 1.6 -.6 2.7 -1.6 4c-1.2 1.6 -2.4 3.6 -2.4 5.6c0 2.6 3 4.4 7.5 4.4s7.5 -1.8 7.5 -4.4c0 -2 -1.2 -4 -2.4 -5.6c-1 -1.3 -1.6 -2.4 -1.6 -4c0 -2.2 -1.3 -4 -3.5 -4',
      },
      { d: 'M9.6 14.4c0 -1.6 1 -2.8 2.4 -2.8s2.4 1.2 2.4 2.8c0 2.2 -1 4.1 -2.4 4.1s-2.4 -1.9 -2.4 -4.1' },
      { d: 'M10.5 6.5v.01' },
      { d: 'M13.5 6.5v.01' },
      { d: 'M10.8 8.8l1.2 .9l1.2 -.9' },
    ],
  },
  // brand-debian.svg
  brandDebian: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      {
        d: 'M12 17c-2.397 -.943 -4 -3.153 -4 -5.635c0 -2.19 1.039 -3.14 1.604 -3.595c2.646 -2.133 6.396 -.27 6.396 3.23c0 2.5 -2.905 2.121 -3.5 1.5c-.595 -.621 -1 -1.5 -.5 -2.5',
      },
      { d: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0' },
    ],
  },
  // brand-fedora.svg
  brandFedora: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      { d: 'M12 3a9 9 0 1 1 0 18h-9v-9a9 9 0 0 1 9 -9' },
      { d: 'M10 17v-6.5a2.5 2.5 0 0 1 4.6 -1.4' },
      { d: 'M7.5 12.5h5' },
    ],
  },
  // brand-arch.svg
  brandArch: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [{ d: 'M12 3l-9 18c2.4 -1.4 4.4 -2.4 6 -3c0 -2.6 1.3 -4.5 3 -4.5s3 1.9 3 4.5c1.6 .6 3.6 1.6 6 3l-9 -18' }],
  },
  // brand-redhat.svg
  brandRedhat: {
    viewBox: '0 0 24 24',
    filled: false,
    strokeWidth: 2.0,
    paths: [
      {
        d: 'M6 10.5l1.436 -4c.318 -.876 .728 -1.302 1.359 -1.302c.219 0 1.054 .365 1.88 .583c.825 .219 .733 -.329 .908 -.487c.176 -.158 .355 -.294 .61 -.294c.242 0 .553 .048 1.692 .448c.759 .267 1.493 .574 2.204 .922c1.175 .582 1.426 .913 1.595 1.507l.816 4.623c2.086 .898 3.5 2.357 3.5 3.682c0 1.685 -1.2 3.818 -5.957 3.818c-6.206 0 -14.043 -4.042 -14.043 -7.32c0 -1.044 1.333 -1.77 4 -2.18',
      },
      { d: 'M6 10.5c0 .969 4.39 3.5 9.5 3.5c1.314 0 3 .063 3 -1.5' },
    ],
  },
};
