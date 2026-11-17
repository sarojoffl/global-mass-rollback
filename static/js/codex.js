// One place for all Codex components and icons used by this app.
import * as codex from '@wikimedia/codex';
import * as iconSet from '@wikimedia/codex-icons';

export const {
  CdxButton,
  CdxCheckbox,
  CdxDialog,
  CdxField,
  CdxIcon,
  CdxInfoChip,
  CdxMessage,
  CdxProgressIndicator,
  CdxTextInput,
  CdxTooltip,
} = codex;

// Helper: return first icon name that exists in this version of codex-icons
const ic = (...names) => {
  for (const n of names) if (iconSet[n]) return iconSet[n];
  return iconSet.cdxIconInfoFilled;
};

export const icons = {
  search:   ic('cdxIconSearch'),
  undo:     ic('cdxIconUndo', 'cdxIconPrevious'),
  ext:      ic('cdxIconLinkExternal'),
  user:     ic('cdxIconUserAvatar'),
  logOut:   ic('cdxIconLogOut', 'cdxIconClose'),
  logIn:    ic('cdxIconLogIn', 'cdxIconUserAvatar'),
  sun:      ic('cdxIconSun', 'cdxIconBright'),
  moon:     ic('cdxIconMoon'),
  check:    ic('cdxIconSuccess', 'cdxIconCheck'),
  error:    ic('cdxIconError', 'cdxIconClose'),
  warn:     ic('cdxIconAlert'),
  clock:    ic('cdxIconClock', 'cdxIconHistory'),
  info:     ic('cdxIconInfoFilled'),
  robot:    ic('cdxIconRobot', 'cdxIconBot', 'cdxIconUserAvatar'),
};
