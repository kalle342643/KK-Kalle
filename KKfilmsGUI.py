# Dit bestand zorgt voor de gebruikersinterface (GUI)van onze programma.
# Vul hier de naam van je programma in:
# KKfilms
#
# Vul hier jullie namen in: 
# Kimo en Kalle


### --------- Bibliotheken en globale variabelen -----------------

from tkinter import *
import KKfilmsSQL

### ---------  Functie definities  -----------------
def zoekFilm(ingevoerde_moviename):
    listboxMenu.delete(0, END)  # maak de listbox leeg
    listboxMenu.insert(0, "Director_ID \t Movie_id \t Genre \t Year\t Rating\ Movie") #print de kolomnamen af

    gevonden_movie = KKfilmsSQL.zoekMovie(ingevoerde_moviename.get())
    for rij in gevonden_movie:
        listboxMenu.insert(END, rij)

def toonMenuInListbox():
    listboxMenu.delete(0, END)  #maak de listbox leeg
    listboxMenu.insert(0, "Director_ID \t Movie_id \t Genre \t Year\t Rating\ Movie")
    Movie_tabel = KKfilmsSQL.vraagOpGegevensMovietabel()
    for regel in Movie_tabel:
        listboxMenu.insert(END, regel) #voeg elke regel uit resultaat in listboxMenu

def haalGeselecteerdeRijOp(event):
    #bepaal op welke regel er geklikt is
    geselecteerdeRegelInLijst = listboxMenu.curselection()[0]
    #haal tekst uit die regel
    geselecteerdeTekst = listboxMenu.get(geselecteerdeRegelInLijst)
    #verwijder tekst uit veld waar je in wilt schrijven, voor het geval er al iets staat
    invoerveldmoviesname.delete(0, END)
    #zet tekst in veld
    invoerveldmoviesname.insert(0, geselecteerdeTekst)


### --------- Hoofdprogramma  ---------------
venster = Tk ()
venster.wm_title("KK Moviedatabase")
venster.iconbitmap("KK.ico")
venster.config(bg="#ffde59")
venster.attributes('-fullscreen', True)

labelIntro = Label(venster, text="welcome!")
labelIntro.grid(row=0, column=0, sticky="W")

labelMovie = Label(venster, text="Movies:!")
labelMovie.grid(row=1, column=0, sticky="W")

ingevoerde_movies = StringVar()
invoerveldmoviesname = Entry(venster, textvariable=ingevoerde_movies)
invoerveldmoviesname.grid(row=1, columnspan=6, sticky="W")

knopZoekOpFilmnaam= Button(venster, text="Zoek Film", width=12, command=zoekFilm)
knopZoekOpFilmnaam.grid(row=1, column=4)

labellistboxMenu = Label(venster, text="Resultaten:")
labellistboxMenu.grid(row=4, column=0, sticky="W")

listboxMenu = Listbox(venster, height=6, width=45)
listboxMenu.grid(row=4, column=1, rowspan=6, columnspan=2, sticky="W")
listboxMenu.bind('<<ListboxSelect>>', haalGeselecteerdeRijOp)

scrollbarlistboxMenu = Scrollbar(venster)
scrollbarlistboxMenu.grid(row=4, column=2, rowspan=6, sticky="E")
listboxMenu.config(yscrollcommand=scrollbarlistboxMenu.set)
scrollbarlistboxMenu.config(command=listboxMenu.yview)

knopToonMovies = Button(venster, text="Toon alle Films", width=12, command=toonMenuInListbox)
knopToonMovies.grid(row=4, column=4)

knopSluit = Button(venster, text="close", width=12, command=venster.destroy)
knopSluit.grid(row=1, column=1000, sticky="E")

venster.mainloop()