# Dit bestand zorgt voor de gebruikersinterface (GUI)van onze programma.
# Vul hier de naam van je programma in:
# KKfilms
#
# Vul hier jullie namen in: 
# Kimo en Kalle
#
#


### --------- Bibliotheken en globale variabelen -----------------

from tkinter import *
import KKfilmsSQL

### ---------  Functie definities  -----------------


### --------- Hoofdprogramma  ---------------
venster = Tk()
venster.wm_title("KK Moviedatabase")
venster.iconbitmap("IMDB logo.ico")
venster.config(bg="yellow")