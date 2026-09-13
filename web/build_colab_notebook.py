import json

# Read standalone html file
with open('index.standalone.html', 'r', encoding='utf-8') as f:
    html_content = f.read()

# Escape triple quotes if any
escaped_html = html_content.replace("'''", "\\'\\'\\'")

notebook = {
    "cells": [
        {
            "cell_type": "markdown",
            "metadata": {},
            "source": [
                "# ⛳ ParkCaddy AR - Google Colab 3D 그린 지면 깊이 측정기\n",
                "\n",
                "구글 코랩(Google Colab)의 **100% 보안 HTTPS 환경**에서 ParkCaddy AR 앱을 실행하고 스마트폰 카메라로 테스트하는 전용 노트북입니다.\n"
            ]
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "# [1단계] 필요 패키지 설치 및 HTML 앱 파일 준비\n",
                "!pip install -q pyqrcode pypng\n",
                "import pyqrcode\n",
                "import http.server\n",
                "import socketserver\n",
                "import threading\n",
                "import subprocess\n",
                "import re\n",
                "from IPython.display import HTML, display, Image\n",
                "\n",
                "PORT = 8000\n",
                f"html_code = '''{escaped_html}'''\n",
                "with open('index.html', 'w', encoding='utf-8') as f:\n",
                "    f.write(html_code)\n",
                "print('✅ ParkCaddy AR 코랩 소스가 준비되었습니다!')\n"
            ]
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "# [2단계] Google Colab 화면 내부에서 즉시 테스트\n",
                "display(HTML(html_code))\n"
            ]
        },
        {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": [
                "# [3단계] 스마트폰 모바일 카메라 접속용 HTTPS 주소 & QR 코드 생성\n",
                "!wget -q -nc https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64\n",
                "!chmod +x cloudflared-linux-amd64\n",
                "\n",
                "def start_server():\n",
                "    handler = http.server.SimpleHTTPRequestHandler\n",
                "    with socketserver.TCPServer(('', PORT), handler) as httpd:\n",
                "        httpd.serve_forever()\n",
                "\n",
                "t = threading.Thread(target=start_server, daemon=True)\n",
                "t.start()\n",
                "\n",
                "proc = subprocess.Popen(['./cloudflared-linux-amd64', 'tunnel', '--url', f'http://localhost:{PORT}'], stderr=subprocess.PIPE, text=True)\n",
                "https_url = None\n",
                "for line in proc.stderr:\n",
                "    if 'trycloudflare.com' in line:\n",
                "        match = re.search(r'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com', line)\n",
                "        if match:\n",
                "            https_url = match.group(0)\n",
                "            break\n",
                "\n",
                "if https_url:\n",
                "    print('\\n' + '='*60)\n",
                "    print(f'🎉 스마트폰 전용 HTTPS 주소: {https_url}')\n",
                "    print('='*60 + '\\n')\n",
                "    qr = pyqrcode.create(https_url)\n",
                "    qr.png('colab_qr.png', scale=6)\n",
                "    display(Image('colab_qr.png'))\n",
                "else:\n",
                "    print('터널 생성 중... 2단계 셀에서 바로 테스트가 가능합니다.')\n"
            ]
        }
    ],
    "metadata": {
        "language_info": {
            "name": "python"
        }
    },
    "nbformat": 4,
    "nbformat_minor": 2
}

with open('ParkCaddy_AR_Colab.ipynb', 'w', encoding='utf-8') as f:
    json.dump(notebook, f, ensure_ascii=False, indent=2)

print("Successfully generated valid ParkCaddy_AR_Colab.ipynb")
