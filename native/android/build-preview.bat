@echo off
setlocal
pushd "%~dp0"
if not defined JAVA_HOME if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
if defined JAVA_HOME (
  "%JAVA_HOME%\bin\java.exe" tools\PreviewBuild.java %*
) else (
  java tools\PreviewBuild.java %*
)
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Build stopped. Read the error and build-logs. No APK was approved.
if not defined CI pause
popd
exit /b %RESULT%
