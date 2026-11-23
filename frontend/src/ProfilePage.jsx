import { useRef, useState } from 'react';
import { PHONE_ERROR, isValidPhone, sanitizePhone } from './phone';

/** Photo de profil, ou initiales si l'utilisateur n'en a pas. */
export function Avatar({ user, size = 40 }) {
  const initials = (user?.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return user?.avatar
    ? <img className="avatar" src={user.avatar} alt={user.name} style={{ width: size, height: size }} />
    : <span className="avatar initials" style={{ width: size, height: size, fontSize: size * 0.4 }}>{initials}</span>;
}

/** Recadre en carré et réduit à 256x256 : la photo envoyée pèse ~20 Ko au lieu de plusieurs Mo. */
function resizeImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const side = Math.min(img.width, img.height);
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
    img.src = url;
  });
}

export default function ProfilePage({ api, notify, session, onUser, onDeleted }) {
  const { user } = session;
  const [info, setInfo] = useState({ name: user.name, phone: user.phone || '' });
  const [pw, setPw] = useState({ currentPassword: '', password: '', confirm: '' });
  const phoneError = info.phone && !isValidPhone(info.phone) ? PHONE_ERROR : '';
  const fileRef = useRef();

  /** Met à jour le profil côté serveur, puis la session locale (en-tête compris). */
  const save = async (args, okMessage) => {
    try {
      const r = await api('user', 'updateUser', args);
      onUser(r.user);
      notify(okMessage);
      return true;
    } catch (e) { notify(e.message, true); return false; }
  };

  const pickPhoto = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return notify('Choisissez un fichier image.', true);
    try { await save({ avatar: await resizeImage(file) }, 'Photo mise à jour.'); }
    catch (err) { notify(err.message, true); }
  };

  const saveInfo = (e) => {
    e.preventDefault();
    if (phoneError) return notify(PHONE_ERROR, true);
    const args = { name: info.name };
    const phone = info.phone.trim();
    if (phone) args.phone = phone;
    else if (user.phone) args.removePhone = true; // champ vidé alors qu'un numéro existait
    save(args, 'Informations enregistrées.');
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (pw.password !== pw.confirm) return notify('Les deux nouveaux mots de passe sont différents.', true);
    if (await save({ currentPassword: pw.currentPassword, password: pw.password }, 'Mot de passe modifié.')) {
      setPw({ currentPassword: '', password: '', confirm: '' });
    }
  };

  const [confirming, setConfirming] = useState(false);
  const [delPw, setDelPw] = useState('');

  const removeAccount = async (e) => {
    e.preventDefault();
    if (!window.confirm('Supprimer définitivement votre compte ? Cette action est irréversible.')) return;
    try { await api('user', 'deleteUser', { password: delPw }); onDeleted(); notify('Compte supprimé.'); }
    catch (err) { notify(err.message, true); }
  };

  return (
    <div className="profile">
      <h1>Mon profil</h1>

      <section className="card photo">
        <Avatar user={user} size={110} />
        <div>
          <h3>{user.name}</h3>
          <p className="muted">{user.email}</p>
          <div className="actions">
            <button className="primary" onClick={() => fileRef.current.click()}>Changer la photo</button>
            {user.avatar && <button onClick={() => save({ removeAvatar: true }, 'Photo supprimée.')}>Supprimer</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
          <p className="muted">La photo est recadrée en carré automatiquement.</p>
        </div>
      </section>

      <form className="card stack" onSubmit={saveInfo}>
        <h3>Informations personnelles</h3>
        <input placeholder="Nom complet" value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} required />
        <input placeholder="Ex : 22 123 456" inputMode="numeric" maxLength={8} value={info.phone}
          onChange={(e) => setInfo({ ...info, phone: sanitizePhone(e.target.value) })} />
        {phoneError && <small className="field-error">{phoneError}</small>}
        <small className="muted">8 chiffres, commençant par 20–29, 50–59 ou 90–99.</small>
        <button className="primary">Enregistrer</button>
      </form>

      <form className="card stack" onSubmit={savePassword}>
        <h3>Changer le mot de passe</h3>
        <input type="password" placeholder="Mot de passe actuel" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
        <input type="password" placeholder="Nouveau mot de passe" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} required />
        <input type="password" placeholder="Confirmer le nouveau mot de passe" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
        <small className="muted">8 caractères minimum, avec une lettre et un chiffre.</small>
        <button className="primary">Modifier le mot de passe</button>
      </form>

      <form className="card stack danger-zone" onSubmit={removeAccount}>
        <h3>Supprimer mon compte</h3>
        <p className="muted">Action irréversible. Vos réservations actives doivent être annulées avant la suppression.</p>
        {confirming ? (
          <>
            <input type="password" placeholder="Saisissez votre mot de passe pour confirmer" value={delPw}
              onChange={(e) => setDelPw(e.target.value)} required autoFocus />
            <div className="actions">
              <button className="danger">Supprimer définitivement</button>
              <button type="button" onClick={() => { setConfirming(false); setDelPw(''); }}>Annuler</button>
            </div>
          </>
        ) : (
          <button type="button" className="danger" onClick={() => setConfirming(true)}>Supprimer mon compte</button>
        )}
      </form>
    </div>
  );
}
