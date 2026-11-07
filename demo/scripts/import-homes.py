#!/usr/bin/env python3
"""Regenerate demo/homes/*.ts from a checkout of home-assistant/frontend.

    python3 import-homes.py <frontend checkout> [--check]

The checkout only needs `demo/src` and `src/translations/en.json`:

    git clone --filter=blob:none --sparse https://github.com/home-assistant/frontend
    git -C frontend sparse-checkout set demo/src src/translations
    git -C frontend checkout <commit>

For each demo (demo/src/configs/<id>/entities.ts) the entity list is copied as
data: the `localize("ui.panel.page-demo…")` calls are replaced by the English
text of en.json, the frontend's imports and types go, and `home` also gets its
floors and areas (configs/home/areas.ts). The energy sensors every demo gets
(demo/src/stubs/entities.ts) become homes/energy.ts. `homes/index.ts` (names,
descriptions) and `entities.ts` (the behaviour) are written by hand and are not
touched. Record the frontend commit in ../NOTICE.md after regenerating.
`--check` only reports which files would change.
"""
import json
import pathlib
import re
import subprocess
import sys

HOMES = {  # id → the name the frontend shows (also in homes/index.ts)
    'home': 'Home page', 'sections': 'Home Demo', 'arsaboo': 'ARS Home',
    'teachingbirds': "Isa's mobile friendly LL", 'kernehed': 'Hem', 'jimpower': 'Kingia Castle',
}
OUT = pathlib.Path(__file__).resolve().parent.parent / 'homes'


def header(name, source):
    return (f'// Entities of the "{name}" demo of the Home Assistant frontend\n'
            f'// (demo.home-assistant.io; home-assistant/frontend, {source},\n'
            '// Apache License 2.0; see ../NOTICE.md). Data only: the names that the frontend\n'
            '// localizes are written out in English.\n')


def localized(text, strings):
    def lookup(m):
        key = m.group(1)
        node = strings
        for part in key.split('.'):
            node = node[part]
        assert isinstance(node, str), key
        return json.dumps(node)
    text = re.sub(r'localize\(\s*"([^"]+)"\s*\)', lookup, text)
    assert 'localize' not in text, 'a localize call was not replaced'
    return text


def body_of(src, head_re):
    # What follows the arrow function's header, verbatim.
    m = re.search(head_re, src)
    assert m, head_re
    return src[m.end():]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    check = '--check' in sys.argv
    if len(args) != 1:
        sys.exit(__doc__)
    root = pathlib.Path(args[0]).resolve()
    strings = json.loads((root / 'src/translations/en.json').read_text())  # keys are full paths, ui.panel.page-demo…
    changed = []

    def write(path, text):
        if path.exists() and path.read_text() == text:
            return
        changed.append(path.name)
        if not check:
            path.write_text(text)

    for home, name in HOMES.items():
        source = f'demo/src/configs/{home}/entities.ts'
        src = (root / source).read_text()
        if home == 'home':
            body = body_of(src, r'export const demoEntitiesHome: DemoConfig\["entities"\] = \(\) => ')
            areas_src = (root / 'demo/src/configs/home/areas.ts').read_text()
            floors = body_of(areas_src, r'export const demoFloorsHome: DemoFloor\[\] = ')
            floors, areas = floors.split('\nexport const demoAreasHome: DemoArea[] = ', 1)
            text = (header(name, source)
                    + "import type { Area, EntityInput, Floor } from '../entities.ts';\n\n"
                    + 'export const entities: EntityInput[] = ' + body.rstrip('\n') + '\n\n'
                    + '// Floors and areas of the same demo (demo/src/configs/home/areas.ts).\n'
                    + 'export const floors: Floor[] = ' + floors.rstrip('\n') + '\n\n'
                    + 'export const areas: Area[] = ' + areas.rstrip('\n') + '\n')
        else:
            body = body_of(src, r'export const demoEntities\w+: DemoConfig\["entities"\] = \((?:localize)?\) =>\n  ')
            text = (header(name, source)
                    + "import type { EntityInput } from '../entities.ts';\n\n"
                    + 'export const entities: EntityInput[] = ' + localized(body, strings).rstrip('\n') + '\n')
        write(OUT / f'{home}.ts', text)

    energy = body_of((root / 'demo/src/stubs/entities.ts').read_text(), r'export const energyEntities = \(\) =>\n  ')
    write(OUT / 'energy.ts',
          '// Energy sensors the Home Assistant frontend adds to every demo\n'
          '// (home-assistant/frontend, demo/src/stubs/entities.ts, Apache License 2.0; see ../NOTICE.md).\n'
          "import type { EntityInput } from '../entities.ts';\n\n"
          'export const energy: EntityInput[] = ' + energy.rstrip('\n') + '\n')

    try:
        commit = subprocess.run(['git', '-C', str(root), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        commit = '(not a git checkout)'
    verb = 'would change' if check else 'written'
    print(f'frontend {commit}: {len(changed)} file(s) {verb}' + (': ' + ', '.join(changed) if changed else ''))
    if check and changed:
        sys.exit(1)


if __name__ == '__main__':
    main()
