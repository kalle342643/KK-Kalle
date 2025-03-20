# Vul hier de naam van je programma in:
# kkmdb
#
# Vul hier jullie namen in:
# Kalle en Kimo
#
#


### --------- Bibliotheken en globale variabelen -----------------
import sqlite3
with sqlite3.connect("Kkfilms.db") as db:
    cursor = db.cursor()  #cursor is object waarmee je data uit de database kan halen

### ---------  Functie definities  -----------------
def maakTabellenAan ():
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tbl_actors(
        Actor_id INTEGER PRIMARY KEY AUTOINCREMENT,
        First_name TEXT NOT NUll,
        Last_name TEXT NOT NULL,
        Actor_birth INTEGER NOT NULL);""")
    print("Tabel 'tbl_actors' aangemaakt.")


def printTabel(tbl_actors): 
 cursor.execute("SELECT * FROM  tbl_actors") 
 opgehaalde_gegevens = cursor.fetchall() 
 print ( "Tabel" 'tbl_actors' ":", opgehaalde_gegevens)


### --------- Hoofdprogramma  ---------------

maakTabellenAan()
printTabel("tbl_actors")


