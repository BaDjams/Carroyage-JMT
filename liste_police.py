import winreg

def lister_polices_installees():
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts")
        for i in range(0, winreg.QueryInfoKey(key)[1]):
            value = winreg.EnumValue(key, i)
            print(f"{value[0]}: {value[1]}")
    except Exception as e:
        print(f"Erreur lors de l'accès au registre Windows : {e}")

lister_polices_installees()
