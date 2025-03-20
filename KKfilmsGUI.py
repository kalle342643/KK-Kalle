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
venster = Tk ()
venster.wm_title("KK Moviedatabase")
venster.iconbitmap("KK.ico")
venster.config(bg="#ffde59")
venster.attributes('-fullscreen', True)

labelIntro = Label(venster, text="welcome!")
labelIntro.grid(row=0, column=0, sticky="W")

labelIntro = Label(venster, text="Movies:!")
labelIntro.grid(row=1, column=0, sticky="W")

ingevoerde_movies = StringVar()
invoerveldmoviesname = Entry(venster, textvariable=ingevoerde_movies)
invoerveldmoviesname.grid(row=1, column=1, sticky="W")

knopSluit = Button(venster, text="close", width=12, command=venster.destroy)
knopSluit.grid(row=17, column=4)




venster.mainloop()