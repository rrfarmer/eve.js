@echo off
setlocal
pushd "%~dp0..\.."
call npm.cmd ci
if errorlevel 1 goto :fail
call npm.cmd --prefix server ci
if errorlevel 1 goto :fail
popd
exit /b 0

:fail
popd
exit /b 1
