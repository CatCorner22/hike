from pathlib import Path
import subprocess

repo = Path('/home/user/workspace/hike')
files = [
    'src/lib/offline/progress-cache.ts',
    'src/lib/offline/wake-lock.ts',
    'src/components/map/safety-nav-map.tsx',
    'src/hooks/use-gps.ts',
    'src/sw.ts',
]
for relative in files:
    content = subprocess.check_output(
        ['git', '-C', str(repo), 'show', f'81db907:{relative}'], text=True
    )
    if relative == 'src/hooks/use-gps.ts':
        old = '    const applyFix = (position: GeolocationPosition) => {\n      lastCallbackRef.current = Date.now();\n      const lat = position.coords.latitude;'
        new = '    const applyFix = (position: GeolocationPosition) => {\n      lastCallbackRef.current = Date.now();\n      deniedRef.current = false;\n      const lat = position.coords.latitude;'
        assert old in content
        content = content.replace(old, new, 1)
    (repo / relative).write_text(content)
