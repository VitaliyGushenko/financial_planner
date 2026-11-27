plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "by.finplanner.companion"
    compileSdk = 34

    defaultConfig {
        applicationId = "by.finplanner.companion"
        minSdk = 26
        targetSdk = 34
        versionCode = 4
        versionName = "1.3"
    }

    // Постоянный ключ подписи: обновления ставятся поверх без удаления приложения.
    signingConfigs {
        create("companion") {
            storeFile = file("../keystore/companion.jks")
            storePassword = "companion123"
            keyAlias = "companion"
            keyPassword = "companion123"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("companion")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("companion")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Никаких внешних зависимостей: только Android SDK и kotlin-stdlib.
