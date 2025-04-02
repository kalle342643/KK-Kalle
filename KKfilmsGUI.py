# Dit bestand zorgt voor de gebruikersinterface (GUI) van ons programma.
# Programma: KKfilms
# Namen: Kimo en Kalle

### --------- Bibliotheken en globale variabelen -----------------
from tkinter import *
import json
import os
import KKfilmsSQL


CONFIG_FILE = "config.json"

# Themas
THEMES = {
    "light": {"bg": "#ffee80", "fg": "#000000", "btn_bg": "#ffffff"},  
    "dark": {"bg": "#303654", "fg": "#000000", "btn_bg": "#ffffff"}
}

# afbeeldingen

def toon_afbeelding(event):
    geselecteerde_index = listboxMovie.curselection()
    if geselecteerde_index:  # Controleer of er iets geselecteerd is
        geselecteerde_film = listboxMovie.get(geselecteerde_index[0])  # Haal de naam van de film op
        print("geselecteerd",geselecteerde_film)


### --------- Functie definities -----------------
def custom_popup():
    popup = Toplevel()
    popup.title("Niet Gevonden")  
    popup.geometry("400x100")  
    popup.resizable(False, False)  

    label = Label(popup, text="We hebben helaas geen resultaten gevonden. \n Controleer de spelling en probeer het opnieuw.", font=("Arial", 12))
    label.pack(pady=20)

    ok_button = Button(popup, text="OK", command=popup.destroy)
    ok_button.pack(pady=10)

def custom_inlog():
    popup = Toplevel()
    popup.title("Niet Gevonden")  
    popup.geometry("500x200")  
    popup.resizable(False, False)  

    Label(popup, text="Gebruikersnaam:", font=("Arial", 10)).pack(pady=5)
    Entry(popup).pack(pady=5)

    Label(popup, text="Wachtwoord:", font=("Arial", 10)).pack(pady=5)
    Entry(popup, show="*").pack(pady=5)

    Button(popup, text="Inloggen", command=popup.destroy).pack(pady=10) 
    

def custom_registratie():
    popup = Toplevel()
    popup.title("Niet Gevonden")  
    popup.geometry("500x300")  
    popup.resizable(False, False)  

    Label(popup, text="Gebruikersnaam:", font=("Arial", 10)).pack(pady=5)
    Entry(popup).pack(pady=5)

    Label(popup, text="Wachtwoord:", font=("Arial", 10)).pack(pady=5)
    Entry(popup, show="*").pack(pady=5)

    Label(popup, text="Herhaal wachtwoord:", font=("Arial", 10)).pack(pady=5)
    Entry(popup, show="*").pack(pady=5)

    Button(popup, text="Registeren", command=popup.destroy).pack(pady=10) 


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

def pas_thema_toe():
    #Past de thema-kleuren toe op de GUI.
    theme = THEMES[current_theme.get()]
    venster.configure(bg=theme["bg"])
    labelIntro.configure(bg=theme["btn_bg"], fg=theme["fg"])
    labelMovie.configure(bg=theme["btn_bg"], fg=theme["fg"])
    labelActor.configure(bg=theme["btn_bg"], fg=theme["fg"])
    labelDirector.configure(bg=theme["btn_bg"], fg=theme["fg"])
    labellistboxMovie.configure(bg=theme["btn_bg"], fg=theme["fg"])
    labellistboxWatchlist.configure(bg=theme["btn_bg"], fg=theme["fg"])
    labellistboxActor.configure(bg=theme["btn_bg"], fg=theme["fg"])
    labellistboxDirector.configure(bg=theme["btn_bg"], fg=theme["fg"])
    listboxMovie.configure(bg=theme["btn_bg"], fg=theme["fg"])
    listboxActors.configure(bg=theme["btn_bg"], fg=theme["fg"])
    listboxWatchlist.configure(bg=theme["btn_bg"], fg=theme["fg"])
    listboxDirector.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopZoekOpFilmnaam.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopToonMovies.configure(bg=theme["btn_bg"], fg=theme["fg"])
    KnopLeegMovies.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopSluit.configure(bg=theme["btn_bg"], fg=theme["fg"])
    Knopthema.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopVoegToeAanWatchlist.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopZoekOpActornaam.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopZoekOpDirector.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopToonActeurs.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopToonDirectors.configure(bg=theme["btn_bg"], fg=theme["fg"])
    KnopLeegActors.configure(bg=theme["btn_bg"], fg=theme["fg"])
    KnopLeegDirectors.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopInlog.configure(bg=theme["btn_bg"], fg=theme["fg"])
    knopRegistratie.configure(bg=theme["btn_bg"], fg=theme["fg"])

def Weizig_thema():
    #Schakelt tussen Dark en Light mode.
    nieuw_thema = "dark" if current_theme.get() == "light" else "light"
    current_theme.set(nieuw_thema)
    save_config(nieuw_thema)
    pas_thema_toe()

def zoekFilm(ingevoerde_moviename):
    #Zoekt een film in de database en toont de resultaten in de listbox.
    listboxMovie.delete(0, END)  # Maak de listbox leeg
    listboxMovie.insert(0, "Director_ID \t Movie_id \t Genre \t Year\t Rating\t Movie")  # Print kolomnamen

    gevonden_movie = KKfilmsSQL.zoekMovie(ingevoerde_moviename.get())
    if not gevonden_movie:
         custom_popup()
    else: 
        for rij in gevonden_movie:
         listboxMovie.insert(END, rij)

def zoekActeur(ingevoerde_Acteurname):
    #Zoekt een film in de database en toont de resultaten in de listbox.
    listboxActors.delete(0, END)  # Maak de listbox leeg
    listboxActors.insert(0, "Actor_ID \t actor_birth \t last_name \t first_naam")  # Print kolomnamen

    gevonden_acteur = KKfilmsSQL.zoekactor(ingevoerde_Acteurname.get())
    if not gevonden_acteur:
         custom_popup()
    else: 
        for rij in gevonden_acteur:
         listboxActors.insert(END, rij)

    

def zoekDirector(ingevoerde_director):
    #Zoekt een film in de database en toont de resultaten in de listbox.
    listboxDirector.delete(0, END)  # Maak de listbox leeg
    listboxDirector.insert(0, "Director_birth\t Director_ID \t Top_movie \t Last_name \t First_name")  # Print kolomnamen

    gevonden_director = KKfilmsSQL.zoekdirector(ingevoerde_director.get())
    if not gevonden_director:
         custom_popup()
    else: 
        for rij in gevonden_director:
         listboxDirector.insert(END, rij)

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

def toonMenuInListboxDirector():
    #Toont alle acteurs in de database.
    listboxDirector.delete(0, END)  # Maak de listbox leeg
    listboxDirector.insert(0, "Director_birth\t Director_ID \t Top_movie \t Last_name \t First_name")
    
    Director_tabel = KKfilmsSQL.vraagOpGegevensDirectortabel()
    for regel in Director_tabel:
        listboxDirector.insert(END, regel)  # Voeg elke regel uit het resultaat in de listbox

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

def haalGeselecteerdeRijOpDirector(event):
    try:
        geselecteerdeRegelInLijst = listboxDirector.curselection()[0]
        geselecteerdeTekst = listboxDirector.get(geselecteerdeRegelInLijst)
        invoervelddirector.delete(0, END)
        invoervelddirector.insert(0, geselecteerdeTekst)
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
    listboxActors.delete(0, END)

def LeegLijstListboxDirector():
    listboxDirector.delete(0, END)

### --------- Hoofdprogramma ---------------
# Creëer het hoofdvenster
venster = Tk()
venster.wm_title("KK Moviedatabase")
venster.iconbitmap("KK.ico")
venster.attributes('-fullscreen', False)  


current_theme = StringVar(value=load_config())


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

labelDirector = Label(venster, text="Directors:")
labelDirector.grid(row=60, column=0, sticky="W")

ingevoerde_Directors = StringVar()
invoervelddirector = Entry(venster, textvariable=ingevoerde_Directors)
invoervelddirector.grid(row=61, columnspan=6, sticky="W")

knopZoekOpFilmnaam = Button(venster, text="Zoek Film", width=12, command=lambda: zoekFilm(ingevoerde_movies))
knopZoekOpFilmnaam.grid(row=2, column=1)

knopInlog = Button(venster, text="login", width=12, command=custom_inlog)
knopInlog.grid(row=0, column=1)

knopRegistratie = Button(venster, text="Registeren", width=12, command=custom_registratie)
knopRegistratie.grid(row=0, column=2)

knopVoegToeAanWatchlist = Button(venster, text="Ad to watchlist", width=12, command=voegToeAanWatchlist)
knopVoegToeAanWatchlist.grid(row=8, column=4)

knopZoekOpActornaam = Button(venster, text="Zoek acteur", width=12, command=lambda: zoekActeur(ingevoerde_acteurs))
knopZoekOpActornaam.grid(row=30, column=1)

knopZoekOpDirector = Button(venster, text="Zoek Director", width=12, command=lambda: zoekDirector(ingevoerde_acteurs))
knopZoekOpDirector.grid(row=61, column=1)

labellistboxgebruikernaam = Label (venster, text= "Naam:")
labellistboxgebruikernaam.grid (row=0, column=5, sticky="W")


labellistboxMovie = Label(venster, text="Resultaten:")
labellistboxMovie.grid(row=4, column=0, sticky="W")

labellistboxWatchlist = Label(venster, text="Watchlist:")
labellistboxWatchlist.grid(row=4, column=9, sticky="E")

labellistboxActor = Label(venster, text="Resultaten:")
labellistboxActor.grid(row=40, column=0, sticky="W")

labellistboxDirector = Label(venster, text="Resultaten:")
labellistboxDirector.grid(row=62, column=0, sticky="W")

listboxMovie = Listbox(venster, height=6, width=45)
listboxMovie.grid(row=4, column=1, rowspan=6, columnspan=2, sticky="W")
listboxMovie.bind('<<ListboxSelect>>', haalGeselecteerdeRijOpMovie)
listboxMovie.bind("<<ListboxSelect>>", toon_afbeelding)

listboxActors = Listbox(venster, height=6, width=45)
listboxActors.grid(row=40, column=1, rowspan=6, columnspan=2, sticky="W")
listboxActors.bind('<<ListboxSelect>>', haalGeselecteerdeRijOpActor)

listboxWatchlist = Listbox(venster, height=6, width=45)
listboxWatchlist.grid(row=4, column=10, rowspan=6, columnspan=2, sticky="E")
listboxWatchlist.bind('<<ListboxSelect>>')

listboxDirector = Listbox(venster, height=6, width=45)
listboxDirector.grid(row=62, column=1, rowspan=6, columnspan=2, sticky="W")
listboxDirector.bind('<<ListboxSelect>>', haalGeselecteerdeRijOpDirector)

scrollbarlistboxMovie = Scrollbar(venster)
scrollbarlistboxMovie.grid(row=4, column=2, rowspan=6, sticky="E")
listboxMovie.config(yscrollcommand=scrollbarlistboxMovie.set)
scrollbarlistboxMovie.config(command=listboxMovie.yview)

knopToonMovies = Button(venster, text="Toon alle Films", width=12, command=toonMenuInListboxMovie)
knopToonMovies.grid(row=4, column=4)

knopToonActeurs = Button(venster, text="Toon alle acteurs", width=12, command=toonMenuInListboxActor)
knopToonActeurs.grid(row=40, column=4)

knopToonDirectors = Button(venster, text="Toon alle directors", width=12, command=toonMenuInListboxDirector)
knopToonDirectors.grid(row=62, column=4)

KnopLeegMovies = Button(venster, text="Leeg Lijst", width=12, command=LeegLijstListboxMovie)
KnopLeegMovies.grid(row=5, column=4)

KnopLeegActors = Button(venster, text="Leeg Lijst", width=12, command=LeegLijstListboxActor)
KnopLeegActors.grid(row=41, column=4)

KnopLeegDirectors = Button(venster, text="Leeg Lijst", width=12, command=LeegLijstListboxDirector)
KnopLeegDirectors.grid(row=63, column=4)

knopSluit = Button(venster, text="Close", width=12, command=venster.destroy)
knopSluit.grid(row=1, column=100, sticky="E")

Knopthema = Button(venster, text="Wissel Modus", width=12, command= Weizig_thema)
Knopthema.grid(row=1, column=101)

# afbeeldingen

fotoPad ="pngfilms/Budapest.png"
padFotoGeselecteerdeMovie = PhotoImage(file=fotoPad)
fotoMovie = Label(venster, width=66.7, height=100, 
image=padFotoGeselecteerdeMovie)
fotoMovie.grid(row=4, column=40)

pas_thema_toe()

venster.mainloop()
