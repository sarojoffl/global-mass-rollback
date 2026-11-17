// codex components and icons we use
import * as codex from '@wikimedia/codex';
import * as iconSet from '@wikimedia/codex-icons';

export const {
  CdxButton, CdxCard, CdxCheckbox, CdxDialog, CdxField, CdxIcon, CdxLookup, CdxMessage, CdxMultiselectLookup,
  CdxProgressBar, CdxProgressIndicator, CdxSelect, CdxTable, CdxTextInput, CdxToggleButton, CdxTooltip
} = codex;

// first icon that exists
const ic = (...names) => {
  for (const n of names) if (iconSet[n]) return iconSet[n];
  return iconSet.cdxIconInfoFilled;
};

export const icons = {
  search: ic('cdxIconSearch'), undo: ic('cdxIconUndo', 'cdxIconPrevious'), ext: ic('cdxIconLinkExternal'),
  user: ic('cdxIconUserAvatar'), group: ic('cdxIconUserGroup'), logOut: ic('cdxIconLogOut', 'cdxIconClose'),
  logIn: ic('cdxIconLogIn', 'cdxIconUserAvatar'), sun: ic('cdxIconSun', 'cdxIconBright'), moon: ic('cdxIconMoon'),
  check: ic('cdxIconSuccess', 'cdxIconCheck'), error: ic('cdxIconError', 'cdxIconClose'), warn: ic('cdxIconAlert'),
  clock: ic('cdxIconClock'), history: ic('cdxIconHistory', 'cdxIconClock'), info: ic('cdxIconInfoFilled'),
  robot: ic('cdxIconRobot', 'cdxIconUserAvatar'), filter: ic('cdxIconFunnel', 'cdxIconFilter'), clear: ic('cdxIconClear', 'cdxIconTrash'),
  expand: ic('cdxIconExpand'), collapse: ic('cdxIconCollapse'), stop: ic('cdxIconStop', 'cdxIconPause'),
  checkAll: ic('cdxIconCheckAll', 'cdxIconCheck'), chart: ic('cdxIconChart', 'cdxIconListBullet'), globe: ic('cdxIconGlobe'),
  more: ic('cdxIconDownTriangle', 'cdxIconExpand'), reload: ic('cdxIconReload', 'cdxIconHistory')
};
