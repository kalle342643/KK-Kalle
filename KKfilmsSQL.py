# Vul hier de naam van je programma in:
# KKfilms
#
# Vul hier jullie namen in:
# Kalle en Kimo


### --------- Bibliotheken en globale variabelen -----------------
import sqlite3
with sqlite3.connect("Kkfilms.db") as db:
    cursor = db.cursor()  #cursor is object waarmee je data uit de database kan halen

### ---------  Functie definities  -----------------
def maakNieuweTabellenAan ():
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tbl_roles(
        Actor_id INTEGER NOT NULL, 
        Movie_id INTEGER NOT NULL,
        FOREIGN KEY (Actor_id) REFERENCES tbl_actors(Actor_id)
        FOREIGN KEY (Movie_id) REFERENCES tbl_movies(Movie_id)
        );""")
    print("Tabel 'tbl_roles' aangemaakt.")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tbl_actors(
        Actor_id INTEGER PRIMARY KEY AUTOINCREMENT,
        Actor_birth INTEGER NOT NULL,
        Last_name TEXT NOT NULL,
        First_name TEXT NOT NUll);""")
    print("Tabel 'tbl_actors' aangemaakt.")
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tbl_directors(
        Director_birth INTEGER NOT NULL,
        Director_id INTEGER NOT NULL,
        Top_movie TEXT NOT NULL,
        Last_name TEXT NOT NULL,
        First_name TEXT NOT NULL,
        FOREIGN KEY (Director_id) REFERENCES tbl_movies(Director_id)
        );""")
    print("Tabel 'tbl_directors' aangemaakt.")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tbl_movies(
        Director_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        Movie_id INTEGER NOT NULL PRIMARY KEY,
        Genre TEXT NOT NULL,
        Year INTEGER,
        Rating REAL NOT NULL,
        Movie_name TEXT NOT NULL);""")
    print("Tabel 'tbl_movies' aangemaakt.")


def printTabel(tbl_actors): 
 cursor.execute("SELECT * FROM  tbl_actors") 
 opgehaalde_gegevens = cursor.fetchall() 
 print ( "Tabel" 'tbl_actors' ":", opgehaalde_gegevens)


### --------- Hoofdprogramma  ---------------

maakNieuweTabellenAan()
printTabel("tbl_actors")


