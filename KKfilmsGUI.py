# Dit bestand zorgt voor de gebruikersinterface (GUI) van ons programma.
# Programma: KKfilms
# Namen: Kimo en Kalle

### --------- Bibliotheken en globale variabelen -----------------
from tkinter import *
import json
import os
import KKfilmsSQL

# Configuratiebestand voor modus opslag
CONFIG_FILE = "config.json"

# 🎨 Kleuren voor de modes
THEMES = {
    "light": {"bg": "#fbffbc", "fg": "#000000", "btn_bg": "#ffffff"},  
    "dark": {"bg": "#7d7070", "fg": "#000000", "btn_bg": "#ffffff"}
}

### --------- Functie definities -----------------
def load_config():
    #Laadt de modus-instelling uit het JSON-bestand.
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as file:
            return json.load(file).get("theme", "light")
    return "light"

def save_config(theme):
    #Slaat de modus-instelling op in het JSON-bestand.
    with open(CONFIG_FILE, "w") as file:
        json.dump({"theme": theme}, file)

def apply_theme():
    #Past de thema-kleuren toe op de GUI.
    theme = THEMES[current_theme.get()]
    venster.configure(bg=theme["bg"])
    labelIntro.configure(bg=theme["bg"], fg=theme["fg"])
    labelMovie.configure(bg=theme["bg"], fg=theme["fg"])
    labellistboxMovie.configure(bg=theme["bg"], fg=theme["fg"])
    listboxMovie.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopZoekOpFilmnaam.configure(bg=theme["btn_bg"])
    knopToonMovies.configure(bg=theme["btn_bg"])
    KnopLeegMovies.configure(bg=theme["btn_bg"])
    knopSluit.configure(bg=theme["btn_bg"])
    Knopthema.configure(bg=theme["btn_bg"])

def Weizig_thema():
    #Schakelt tussen Dark en Light mode.
    new_theme = "dark" if current_theme.get() == "light" else "light"
    current_theme.set(new_theme)
    save_config(new_theme)
    apply_theme()

def zoekFilm(ingevoerde_moviename):
    #Zoekt een film in de database en toont de resultaten in de listbox.
    listboxMovie.delete(0, END)  # Maak de listbox leeg
    listboxMovie.insert(0, "Director_ID \t Movie_id \t Genre \t Year\t Rating\t Movie")  # Print kolomnamen

    gevonden_movie = KKfilmsSQL.zoekMovie(ingevoerde_moviename.get())
    for rij in gevonden_movie:
        listboxMovie.insert(END, rij)

def zoekActeur(ingevoerde_Acteurname):
    #Zoekt een film in de database en toont de resultaten in de listbox.
    listboxActors.delete(0, END)  # Maak de listbox leeg
    listboxActors.insert(0, "Actor_ID \t actor_birth \t last_name \t first_naam")  # Print kolomnamen

    gevonden_acteur = KKfilmsSQL.zoekactor(ingevoerde_Acteurname.get())
    for rij in gevonden_acteur:
        listboxActors.insert(END, rij)

def toonMenuInListboxMovie():
    #Toont alle films in de database.
    listboxMovie.delete(0, END)  # Maak de listbox leeg
    listboxMovie.insert(0, "Director_ID \t Movie_id \t Genre \t Year\t Rating\t Movie")

    Movie_tabel = KKfilmsSQL.vraagOpGegevensMovietabel()
    for regel in Movie_tabel:
        listboxMovie.insert(END, regel)  # Voeg elke regel uit het resultaat in de listbox

def toonMenuInListboxActor():
    #Toont alle acteurs in de database.
    listboxActors.delete(0, END)  # Maak de listbox leeg
    listboxActors.insert(0, "Actor_ID \t actor_birth \t last_name \t first_naam")
    
    Actor_tabel = KKfilmsSQL.vraagOpGegevensActortabel()
    for regel in Actor_tabel:
        listboxActors.insert(END, regel)  # Voeg elke regel uit het resultaat in de listbox

def haalGeselecteerdeRijOpMovie(event):
    try:
        geselecteerdeRegelInLijst = listboxMovie.curselection()[0]
        geselecteerdeTekst = listboxMovie.get(geselecteerdeRegelInLijst)
        invoerveldmoviesname.delete(0, END)
        invoerveldmoviesname.insert(0, geselecteerdeTekst)
    except IndexError:
        pass  # Voorkomt crash als er niets is geselecteerd

def haalGeselecteerdeRijOpActor(event):
    try:
        geselecteerdeRegelInLijst = listboxActors.curselection()[0]
        geselecteerdeTekst = listboxActors.get(geselecteerdeRegelInLijst)
        invoerveldactorname.delete(0, END)
        invoerveldactorname.insert(0, geselecteerdeTekst)
    except IndexError:
        pass  # Voorkomt crash als er niets is geselecteerd

#voeg de geselecteerde film toe
#in de watchlisttabel
#en toon de film in de listbox op het scherm
def voegToeAanWatchlist():
    selected_index = listboxMovie.curselection()  # Haal de geselecteerde index op
    if selected_index:  # Controleer of er iets geselecteerd is
        geselecteerde_regel = listboxMovie.get(selected_index[0])  # Haal de geselecteerde film op  
        Year = geselecteerde_regel[3] 
        Movie_name = geselecteerde_regel[5] 
        Rating = geselecteerde_regel[4]

            # Haal de huidige watchlist op
        huidige_watchlist = [listboxWatchlist.get(i) for i in range(listboxWatchlist.size())]

            # Controleer of de film al in de watchlist staat
        if (Movie_name, Year, Rating) not in huidige_watchlist:
                KKfilmsSQL.voegToeAanWatchlist(Movie_name, Year, Rating)  # Voeg toe aan database

                watchlist_tabel = KKfilmsSQL.vraagOpGegevensWatchlist()  # Haal de bijgewerkte watchlist op

                listboxWatchlist.delete(0, END)  # Maak de watchlist leeg

                for regel in watchlist_tabel:  
                    listboxWatchlist.insert(END, regel)
        else:
                print("Deze film staat al in de watchlist.")
    else:
        print("Geen film geselecteerd")

def LeegLijstListboxMovie():
    #Maakt de listbox leeg.
    listboxMovie.delete(0, END)

def LeegLijstListboxActor():
    #Maakt de listbox leeg.
    listboxActors.delete(0, END)

### --------- Hoofdprogramma ---------------
# Creëer het hoofdvenster
venster = Tk()
venster.wm_title("KK Moviedatabase")
venster.iconbitmap("KK.ico")
venster.attributes('-fullscreen', True)  # Zorgt ervoor dat het venster fullscreen is

# Modus laden
current_theme = StringVar(value=load_config())

# 🎨 Maak alle GUI-elementen aan
labelIntro = Label(venster, text="Welcome!")
labelIntro.grid(row=0, column=0, sticky="W")

labelMovie = Label(venster, text="Movies:")
labelMovie.grid(row=1, column=0, sticky="W")

ingevoerde_movies = StringVar()
invoerveldmoviesname = Entry(venster, textvariable=ingevoerde_movies)
invoerveldmoviesname.grid(row=2, columnspan=6, sticky="W")

labelActor = Label(venster, text="Actors:")
labelActor.grid(row=14, column=0, sticky="W")

ingevoerde_acteurs = StringVar()
invoerveldactorname = Entry(venster, textvariable=ingevoerde_acteurs)
invoerveldactorname.grid(row=30, columnspan=6, sticky="W")

knopZoekOpFilmnaam = Button(venster, text="Zoek Film", width=12, command=lambda: zoekFilm(ingevoerde_movies))
knopZoekOpFilmnaam.grid(row=1, column=4)

knopVoegToeAanWatchlist = Button(venster, text="Ad to watchlist", width=12, command=voegToeAanWatchlist)
knopVoegToeAanWatchlist.grid(row=8, column=4)

knopZoekOpActornaam = Button(venster, text="Zoek acteur", width=12, command=lambda: zoekActeur(ingevoerde_acteurs))
knopZoekOpActornaam.grid(row=45, column=4)

labellistboxMovie = Label(venster, text="Resultaten:")
labellistboxMovie.grid(row=4, column=0, sticky="W")

labellistboxWatchlist = Label(venster, text="Watchlist:")
labellistboxWatchlist.grid(row=4, column=9, sticky="E")

labellistboxActor = Label(venster, text="Resultaten:")
labellistboxActor.grid(row=40, column=0, sticky="W")

listboxActors = Listbox(venster, height=6, width=45)
listboxActors.grid(row=40, column=1, rowspan=6, columnspan=2, sticky="W")
listboxActors.bind('<<ListboxSelect>>', haalGeselecteerdeRijOpActor)

listboxMovie = Listbox(venster, height=6, width=45)
listboxMovie.grid(row=4, column=1, rowspan=6, columnspan=2, sticky="W")
listboxMovie.bind('<<ListboxSelect>>', haalGeselecteerdeRijOpMovie)

listboxWatchlist = Listbox(venster, height=6, width=45)
listboxWatchlist.grid(row=4, column=10, rowspan=6, columnspan=2, sticky="E")
listboxWatchlist.bind('<<ListboxSelect>>')

scrollbarlistboxMovie = Scrollbar(venster)
scrollbarlistboxMovie.grid(row=4, column=2, rowspan=6, sticky="E")
listboxMovie.config(yscrollcommand=scrollbarlistboxMovie.set)
scrollbarlistboxMovie.config(command=listboxMovie.yview)

knopToonMovies = Button(venster, text="Toon alle Films", width=12, command=toonMenuInListboxMovie)
knopToonMovies.grid(row=4, column=4)

knopToonActeurs = Button(venster, text="Toon alle acteurs", width=12, command=toonMenuInListboxActor)
knopToonActeurs.grid(row=40, column=4)

KnopLeegMovies = Button(venster, text="Leeg Lijst", width=12, command=LeegLijstListboxMovie)
KnopLeegMovies.grid(row=5, column=4)

KnopLeegActors = Button(venster, text="Leeg Lijst", width=12, command=LeegLijstListboxActor)
KnopLeegActors.grid(row=40, column=4)

knopSluit = Button(venster, text="Close", width=12, command=venster.destroy)
knopSluit.grid(row=1, column=100, sticky="E")

Knopthema = Button(venster, text="Wissel Modus", width=12, command= Weizig_thema)
Knopthema.grid(row=1, column=101)

# 🎨 Pas het thema toe na het aanmaken van de widgets
apply_theme()

venster.mainloop()
