import hero1600Avif from "../assets/hero-home-1600.avif";
import hero2048Avif from "../assets/hero-home-2048.avif";
import hero2560Avif from "../assets/hero-home-2560.avif";
import hero2880Avif from "../assets/hero-home-2880.avif";
import hero3456Avif from "../assets/hero-home-3456.avif";
import hero3840Avif from "../assets/hero-home-3840.avif";
import hero4200Avif from "../assets/hero-home-4200.avif";
import hero1600Webp from "../assets/hero-home-1600.webp";
import hero2880Webp from "../assets/hero-home-2880.webp";
import hero4200Webp from "../assets/hero-home-4200.webp";
import heroPhoneAvif from "../assets/hero-home-phone.avif";
import heroPhoneWebp from "../assets/hero-home-phone.webp";

function widthSet(entries) {
  return entries.map(([url, width]) => `${url} ${width}w`).join(", ");
}

const AVIF_SRCSET = widthSet([
  [hero1600Avif, 1600],
  [hero2048Avif, 2048],
  [hero2560Avif, 2560],
  [hero2880Avif, 2880],
  [hero3456Avif, 3456],
  [hero3840Avif, 3840],
  [hero4200Avif, 4200],
]);
// Only browsers without AVIF get these, so fewer steps will do.
const WEBP_SRCSET = widthSet([
  [hero1600Webp, 1600],
  [hero2880Webp, 2880],
  [hero4200Webp, 4200],
]);

// How wide the hero draws the art, from its sizing in HomePage.module.css: it covers
// the hero, which is never shorter than 560px (640px at 780px and below), so the
// 2.39:1 frame is never narrower than 1337px (1528px).
const SIZES = "(max-width: 780px) 1528px, (max-width: 1337px) 1337px, 100vw";

// Phones show only a narrow slice of the frame, so they get a portrait crop of it,
// centred on the falling figure, instead of the whole 4200px frame. Past 470px the crop
// would no longer cover the 640px-tall hero at the same scale.
const PHONE_MEDIA = "(max-width: 470px)";

/**
 * The home hero's artwork: a film still drawn edge to edge behind the
 * headline, picked by the browser at the size and format the screen needs.
 */
export function HeroArt({ className }) {
  return (
    <picture className={className}>
      <source media={PHONE_MEDIA} type="image/avif" srcSet={heroPhoneAvif} />
      <source media={PHONE_MEDIA} type="image/webp" srcSet={heroPhoneWebp} />
      <source type="image/avif" srcSet={AVIF_SRCSET} sizes={SIZES} />
      <img src={hero1600Webp} srcSet={WEBP_SRCSET} sizes={SIZES} alt="" fetchPriority="high" />
    </picture>
  );
}
