@echo off
rem Server Exam Support をローカルで起動（このPCの中だけで動くWebサーバ）
cd /d "%~dp0"
start "" http://127.0.0.1:8755/
python serve.py
