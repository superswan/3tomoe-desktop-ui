$shell = New-Object -ComObject Shell.Application
$windows = $shell.Windows()

foreach ($window in $windows) {
  try {
    $window.Quit()
  }
  catch {
  }
}
