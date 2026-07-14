"""Локальный статический сервер для превью (см. .claude/launch.json) — обычный http.server,
но с Cache-Control: no-store на каждый ответ. Без этого браузер иногда держит старую версию
JS/CSS после правки (даже после обычного reload) — статический сайт без сборки особенно к этому
чувствителен, т.к. нет хешей в именах файлов, которые обычно инвалидируют кэш сами по себе."""
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8723
    # Необязательный 2-й аргумент — папка для раздачи (иначе текущая): нужен, когда превью
    # запускается из другой рабочей папки и launch.json не может задать cwd вне проекта.
    if len(sys.argv) > 2:
        os.chdir(sys.argv[2])
    # ThreadingHTTPServer — не plain HTTPServer: страница на загрузке шлёт ~30 параллельных
    # запросов ES-модулей, однопоточный сервер обслуживает их по очереди и под такой нагрузкой
    # браузер может оборвать соединение по таймауту (страница падает в chrome-error). Тот же
    # выбор, что и у `python -m http.server` (использует ThreadingHTTPServer с Python 3.7+).
    ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
