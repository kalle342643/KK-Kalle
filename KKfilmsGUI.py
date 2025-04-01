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
    """Laadt de modus-instelling uit het JSON-bestand."""
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as file:
            return json.load(file).get("theme", "light")
    return "light"

def save_config(theme):
    """Slaat de modus-instelling op in het JSON-bestand."""
    with open(CONFIG_FILE, "w") as file:
        json.dump({"theme": theme}, file)

def apply_theme():
    """Past de thema-kleuren toe op de GUI."""
    theme = THEMES[current_theme.get()]
    venster.configure(bg=theme["bg"])
    labelIntro.configure(bg=theme["bg"], fg=theme["fg"])
    labelMovie.configure(bg=theme["bg"], fg=theme["fg"])
    labellistboxMenu.configure(bg=theme["bg"], fg=theme["fg"])
    listboxMenu.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopZoekOpFilmnaam.configure(bg=theme["btn_bg"])
    knopToonMovies.configure(bg=theme["btn_bg"])
    KnopLeegMovies.configure(bg=theme["btn_bg"])
    knopSluit.configure(bg=theme["btn_bg"])
    Knopthema.configure(bg=theme["btn_bg"])

def Weizig_thema():
    """Schakelt tussen Dark en Light mode."""
    new_theme = "dark" if current_theme.get() == "light" else "light"
    current_theme.set(new_theme)
    save_config(new_theme)
    apply_theme()

def zoekFilm(ingevoerde_moviename):
    #Zoekt een film in de database en toont de resultaten in de listbox.
    listboxMenu.delete(0, END)  # Maak de listbox leeg
    listboxMenu.insert(0, "Director_ID \t Movie_id \t Genre \t Year\t Rating\ Movie")  # Print kolomnamen

    gevonden_movie = KKfilmsSQL.zoekMovie(ingevoerde_moviename.get())
    for rij in gevonden_movie:
        listboxMenu.insert(END, rij)

def zoekActeur(ingevoerde_Acteurname):
    #Zoekt een film in de database en toont de resultaten in de listbox.
    listboxActors.delete(0, END)  # Maak de listbox leeg
    listboxActors.insert(0, "Actor_ID \t actor_birth \t last_name \t first_naam")  # Print kolomnamen

    gevonden_acteur = KKfilmsSQL.zoekActeus(ingevoerde_Acteurname.get())
    for rij in gevonden_acteur:
        listboxMenu.insert(END, rij)

def toonMenuInListbox():
    """Toont alle films in de database."""
    listboxMenu.delete(0, END)  # Maak de listbox leeg
    listboxMenu.insert(0, "Director_ID \t Movie_id \t Genre \t Year\t Rating\ Movie")


    Movie_tabel = KKfilmsSQL.vraagOpGegevensMovietabel()
    for regel in Movie_tabel:
        listboxMenu.insert(END, regel)  # Voeg elke regel uit het resultaat in de listbox

def toonMenuInListbox1():
    """Toont alle acteurs in de database."""
    listboxActors.delete(0, END)  # Maak de listbox leeg
    listboxActors.insert(0, "Actor_ID \ actor_birth \ last_name \ first_naam")
    
    Actor_tabel = KKfilmsSQL.vraagOpGegevensActortabel()
    for regel in Actor_tabel:
        listboxMenu.insert(END, regel)  # Voeg elke regel uit het resultaat in de listbox

def haalGeselecteerdeRijOp1(event):
    try:
        geselecteerdeRegelInLijst = listboxMenu.curselection()[0]
        geselecteerdeTekst = listboxMenu.get(geselecteerdeRegelInLijst)
        invoerveldmoviesname.delete(0, END)
        invoerveldmoviesname.insert(0, geselecteerdeTekst)
    except IndexError:
        pass  # Voorkomt crash als er niets is geselecteerd

def haalGeselecteerdeRijOp(event):
    try:
        geselecteerdeRegelInLijst = listboxMenu.curselection()[0]
        geselecteerdeTekst = listboxMenu.get(geselecteerdeRegelInLijst)
        invoerveldactorname.delete(0, END)
        invoerveldactorname.insert(0, geselecteerdeTekst)
    except IndexError:
        pass  # Voorkomt crash als er niets is geselecteerd

def LeegLijstListbox():
    """Maakt de listbox leeg."""
    listboxMenu.delete(0, END)

### --------- Hoofdprogramma ---------------
venster = Tk()
venster.wm_title("KK Moviedatabase")
venster.iconbitmap("KK.ico")
venster.attributes('-fullscreen', True)



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


knopZoekOpActornaam = Button(venster, text="Zoek acteur", width=12, command=lambda: zoekActeur(ingevoerde_acteurs))
knopZoekOpActornaam.grid(row=45, column=4)

labellistboxMenu = Label(venster, text="Resultaten:")
labellistboxMenu.grid(row=4, column=0, sticky="W")

labellistboxMenu = Label(venster, text="Resultaten:")
labellistboxMenu.grid(row=40, column=0, sticky="W")

listboxActors = Listbox(venster, height=6, width=45)
listboxActors.grid(row=40, column=1, rowspan=6, columnspan=2, sticky="W")
listboxActors.bind('<<ListboxSelect>>', haalGeselecteerdeRijOp)

listboxMenu = Listbox(venster, height=6, width=45)
listboxMenu.grid(row=4, column=1, rowspan=6, columnspan=2, sticky="W")
listboxMenu.bind('<<ListboxSelect>>', haalGeselecteerdeRijOp1)



scrollbarlistboxMenu = Scrollbar(venster)
scrollbarlistboxMenu.grid(row=4, column=2, rowspan=6, sticky="E")
listboxMenu.config(yscrollcommand=scrollbarlistboxMenu.set)
scrollbarlistboxMenu.config(command=listboxMenu.yview)

knopToonMovies = Button(venster, text="Toon alle Films", width=12, command=toonMenuInListbox)
knopToonMovies.grid(row=4, column=4)

knopToonActeurs = Button(venster, text="Toon alle acteurs", width=12, command=toonMenuInListbox1)
knopToonActeurs.grid(row=40, column=4)

KnopLeegMovies = Button(venster, text="Leeg Lijst", width=12, command=LeegLijstListbox)
KnopLeegMovies.grid(row=5, column=4)

knopSluit = Button(venster, text="Close", width=12, command=venster.destroy)
knopSluit.grid(row=1, column=1000, sticky="E")


Knopthema = Button(venster, text="Wissel Modus", width=12, command= Weizig_thema)
Knopthema.grid(row=2, column=4)

# 🎨 Pas het thema toe na het aanmaken van de widgets
apply_theme()

venster.mainloop()
