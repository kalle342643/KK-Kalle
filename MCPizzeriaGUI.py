# Dit bestand zorgt voor de gebruikersinterface (GUI)van onze programma.
# Vul hier de naam van je programma in:
# MCMDB
#
# Vul hier jullie namen in: 
# Kimo en Kalle
#
#


### --------- Bibliotheken en globale variabelen -----------------
from tkinter import *
import MCPizzeriaSQL


### ---------  Functie definities  -----------------


### --------- Hoofdprogramma  ---------------

venster = Tk()
venster.wm_title("MC Pizzeria")

labelIntro = Label(venster, text="Welkom!")
labelIntro.grid(row=0, column=0, sticky="W")

knopSluit = Button(venster, text="Sluiten", width=12, command=venster.destroy)
knopSluit.grid(row=17, column=4)

#reageert op gebruikersinvoer, deze regel als laatste laten staan
venster.mainloop()










#reageert op gebruikersinvoer, deze regel als laatste laten staan
venster.mainloop()
