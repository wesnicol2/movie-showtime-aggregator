from pathlib import Path

from movie_showtime_aggregator.storage import PersistentSettings, SettingsStore


def test_settings_store_round_trips_secrets_and_public_view_hides_them(tmp_path: Path):
    store = SettingsStore(tmp_path / "common" / "settings.json")
    saved = PersistentSettings(
        home_address="123 Main St, Phoenix, AZ 85004",
        home_display_name="123 Main St, Phoenix, Arizona",
        home_latitude=33.45,
        home_longitude=-112.07,
        amc_vendor_key="amc-secret",
        omdb_api_key="omdb-secret",
        amc_a_list=True,
    )

    store.save(saved)
    loaded = store.load()

    assert loaded == saved
    assert store.path.exists()
    public = loaded.public_dict()
    assert public["amc_vendor_key_set"] is True
    assert public["omdb_api_key_set"] is True
    assert public["amc_a_list"] is True
    assert "amc-secret" not in str(public)
    assert "omdb-secret" not in str(public)


def test_settings_store_updates_without_erasing_existing_secret(tmp_path: Path):
    store = SettingsStore(tmp_path / "settings.json")
    store.save(PersistentSettings(amc_vendor_key="keep-me"))

    updated = store.update(amc_a_list=True)

    assert updated.amc_vendor_key == "keep-me"
    assert updated.amc_a_list is True
